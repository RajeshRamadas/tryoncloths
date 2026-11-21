import { Analytics, installAnalyticsRoutes } from "./analytics.js";
import { AvatarViewStore } from "./avatar-view-store.js";
import {
  installTrackingSchema,
  validateLookTracking,
  attributeLook,
  lookAttribution,
} from "./analytics-tracking.js";
import { transaction, installSharedCatalogueSchema } from "./catalogue-fields.js";
import { installSyncSchema, installSyncRoutes } from "./catalogue-sync.js";
import { installPhotoSchema, installPhotoRoutes } from "./photo-jobs.js";
import { BrandingStore, installBrandingRoutes } from "./branding.js";
import { ShopPageStore, installShopPageRoutes } from "./shop-page.js";
import { ShopperBudgets, installShopperBudgetRoutes } from "./shopper-budgets.js";
import { ImageSlots } from "./image-slots.js";
import { installShopifyShopperSchema } from "./shopify-shopper.js";
import { installShopifyShopperOwner } from "./shopify-shopper-routes.js";
import { SizeStore, installSizeRoutes } from "./size.js";
import { installCatalogueRoutes } from "./catalogue-import.js";
import { installCampaignRoutes } from "./whatsapp-campaigns.js";
import { installWhatsAppSchema } from "./whatsapp-schema.js";
import { installWhatsAppRoutes } from "./whatsapp.js";
import { ShareStore, installShareRoutes } from "./sharing.js";
import { CustomerStore, installCustomerRoutes } from "./customers.js";
import { installAdminSchema, claimTrial, trialKeys } from "./commercial-admin.js";
import { DatabaseSync } from "node:sqlite";
import { AVATAR_REVIEW_POLICY_VERSION, validateAvatarApproval } from "./avatar-approval.js";
import { verifyAvatarGenerationReceipt } from "./avatar-generation.js";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  profiles,
  recommendProfile,
  validTemplateTone,
  DEFAULT_TEMPLATE_TONE,
  parseProfileSelection,
} from "../src/profiles.js";
import { GarmentStore } from "./garment-store.js";
import {
  migrateTenancy,
  migrateUserSessions,
  storesForUser,
  storeMembership,
  requireRole,
} from "./tenancy.js";
import { installStaffRoutes } from "./staff.js";
import { BillingStore, installBillingRoutes } from "./billing.js";
const scrypt = promisify(scryptCallback);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cookieName = "forme_session";
const lifetime = 30 * 24 * 3600 * 1000;
const avatarVersionsPageSize = 20;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const emailValue = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

async function savedImage(value, view = "full") {
  if (
    typeof value !== "string" ||
    value.length > 14_000_000 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw error("Use an avatar PNG under 10 MB.");
  let image, thumbnail;
  try {
    const source = sharp(Buffer.from(value.split(",")[1], "base64"), {
      limitInputPixels: 16_000_000,
    });
    const meta = await source.metadata();
    if (
      meta.format !== "png" ||
      meta.width < 128 ||
      meta.height < 256 ||
      (view === "hands"
        ? meta.width !== 1024 || meta.height !== 1024
        : view === "portrait"
          ? meta.width !== 1152 || meta.height !== 1536
          : meta.width >= meta.height)
    )
      throw new Error();
    image = await source.rotate().png().toBuffer();
    if (image.length > 10 * 1024 * 1024) throw new Error();
    thumbnail = await sharp(image).resize({ height: 160 }).png().toBuffer();
  } catch {
    throw error("Use a valid full-body portrait PNG under 10 MB and at most 16 megapixels.");
  }
  return { image, thumbnail };
}

export class AccountStore {
  constructor(directory, { signupTrial = true } = {}) {
    this.signupTrial = signupTrial;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, "accounts.sqlite");
    this.db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS avatars(id TEXT NOT NULL, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, name TEXT NOT NULL, profileId TEXT NOT NULL, heightCm REAL NOT NULL, weightKg REAL NOT NULL, source TEXT NOT NULL, savedAt INTEGER NOT NULL, image BLOB NOT NULL, thumbnail BLOB NOT NULL, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS looks(id TEXT NOT NULL, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, avatarId TEXT NOT NULL, name TEXT NOT NULL, garments TEXT NOT NULL, image BLOB NOT NULL, thumbnail BLOB NOT NULL, savedAt INTEGER NOT NULL, PRIMARY KEY(account,id), FOREIGN KEY(account,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS looks_avatar ON looks(account,avatarId);`);
    if (
      !this.db
        .prepare("PRAGMA table_info(avatars)")
        .all()
        .some((c) => c.name === "body_type")
    )
      this.db.exec("ALTER TABLE avatars ADD COLUMN body_type TEXT NOT NULL DEFAULT 'male'");
    if (
      !this.db
        .prepare("PRAGMA table_info(avatars)")
        .all()
        .some((c) => c.name === "template_tone")
    )
      this.db.exec("ALTER TABLE avatars ADD COLUMN template_tone TEXT NOT NULL DEFAULT 'medium'");
    transaction(this.db, () => {
      // Older avatars default to draft and have no recorded profile selection.
      const avatarColumns = this.db
        .prepare("PRAGMA table_info(avatars)")
        .all()
        .map((c) => c.name);
      if (!avatarColumns.includes("approved_at"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN approved_at INTEGER");
      if (!avatarColumns.includes("approved_by"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN approved_by TEXT");
      if (!avatarColumns.includes("review_policy"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN review_policy INTEGER NOT NULL DEFAULT 0");
      if (!avatarColumns.includes("profile_selection"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN profile_selection TEXT");
      if (!avatarColumns.includes("generation_provenance"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN generation_provenance TEXT");
      if (!avatarColumns.includes("approved_version"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN approved_version INTEGER");
      if (!avatarColumns.includes("master_id"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN master_id TEXT");
      if (!avatarColumns.includes("master_version"))
        this.db.exec("ALTER TABLE avatars ADD COLUMN master_version INTEGER NOT NULL DEFAULT 1");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS avatar_master_sequences (
          account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          masterId TEXT NOT NULL,
          last_version INTEGER NOT NULL,
          PRIMARY KEY(account,masterId)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS avatar_master_versions ON avatars(account,COALESCE(master_id,id),master_version);
        CREATE TRIGGER IF NOT EXISTS avatar_master_sequence_cleanup AFTER DELETE ON avatars
        BEGIN
          DELETE FROM avatar_master_sequences WHERE account=OLD.account AND masterId=COALESCE(OLD.master_id,OLD.id)
          AND NOT EXISTS(SELECT 1 FROM avatars WHERE account=OLD.account AND COALESCE(master_id,id)=COALESCE(OLD.master_id,OLD.id));
        END;
        CREATE TABLE IF NOT EXISTS avatar_versions (
          account TEXT NOT NULL,
          avatarId TEXT NOT NULL,
          version INTEGER NOT NULL,
          image_sha256 TEXT NOT NULL,
          metadata TEXT NOT NULL,
          approved_at INTEGER NOT NULL,
          approved_by TEXT NOT NULL,
          review_policy INTEGER NOT NULL,
          PRIMARY KEY(account,avatarId,version),
          FOREIGN KEY(account,avatarId) REFERENCES avatars(account,id) ON DELETE CASCADE
        );
        CREATE TRIGGER IF NOT EXISTS avatar_versions_immutable BEFORE UPDATE ON avatar_versions
        BEGIN SELECT RAISE(ABORT,'Approved avatar versions are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS avatar_version_image_immutable BEFORE UPDATE OF image ON avatars
        WHEN NEW.image <> OLD.image AND EXISTS(
          SELECT 1 FROM avatar_versions WHERE account=OLD.account AND avatarId=OLD.id
        )
        BEGIN SELECT RAISE(ABORT,'Approved avatar PNGs are immutable'); END;`);
      const columns = this.db
        .prepare("PRAGMA table_info(looks)")
        .all()
        .map((c) => c.name);
      if (!columns.includes("view"))
        this.db.exec("ALTER TABLE looks ADD COLUMN view TEXT NOT NULL DEFAULT 'full'");
      if (!columns.includes("itemsJson"))
        this.db.exec("ALTER TABLE looks ADD COLUMN itemsJson TEXT NOT NULL DEFAULT '[]'");
      if (!columns.includes("previewMode"))
        this.db.exec("ALTER TABLE looks ADD COLUMN previewMode TEXT NOT NULL DEFAULT 'ai'");
      if (!columns.includes("handsGeometryJson"))
        this.db.exec("ALTER TABLE looks ADD COLUMN handsGeometryJson TEXT");
    });
    this.garments = new GarmentStore(this);
    try {
      migrateTenancy(this.db);
      migrateUserSessions(this.db);
      this.billing = new BillingStore(this.db);
      installAdminSchema(this.db);
      this.customers = new CustomerStore(this.db);
      this.sharing = new ShareStore(this);
      installWhatsAppSchema(this.db);
      this.sizes = new SizeStore(this);
      installTrackingSchema(this.db);
      this.analytics = new Analytics(this);
      installSharedCatalogueSchema(this.db);
      installSyncSchema(this.db);
      installPhotoSchema(this.db);
      this.branding = new BrandingStore(this);
      this.shopPages = new ShopPageStore(this);
    } catch (error) {
      this.db.close();
      throw error;
    }
    try {
      this.imageSlots = new ImageSlots(this.billing);
      this.shoppers = new ShopperBudgets(this);
      installShopifyShopperSchema(this);
      this.views = new AvatarViewStore(this);
      this.customers.onRemove = (account, id) => {
        for (const row of this.db
          .prepare("SELECT id FROM avatars WHERE account=? AND customer=?")
          .all(account.id, id))
          this.views.invalidate(account.id, row.id);
      };
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.views?.close();
    this.db.close();
  }
  async register(input) {
    const email = emailValue(input.email);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      !name ||
      name.length > 80
    )
      throw error("Enter a store name and valid email address.");
    if (
      typeof input.password !== "string" ||
      input.password.length < 12 ||
      input.password.length > 128
    )
      throw error("Use a password between 12 and 128 characters.");
    if (this.signupTrial) trialKeys({ ...input, email });
    const salt = randomBytes(16).toString("hex");
    const password = await scrypt(input.password, salt, 64);
    const account = { id: randomBytes(16).toString("hex"), email, name };
    try {
      this.db.exec("BEGIN IMMEDIATE");
      if (this.db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
        throw error("This email is already registered. Sign in to its store account.", 409);
      const org = randomBytes(16).toString("hex"),
        user = randomBytes(16).toString("hex");
      this.db
        .prepare("INSERT INTO accounts VALUES(?,?,?,?,?)")
        .run(account.id, email, name, salt, password);
      this.db
        .prepare("INSERT INTO orgs(id,name,billingEmail,plan,status,createdAt) VALUES(?,?,?,?,?,?)")
        .run(
          org,
          name,
          email,
          this.signupTrial ? "trial" : "pilot",
          this.signupTrial ? "trial" : "active",
          Date.now(),
        );
      this.db.prepare("INSERT INTO stores(id,org,name) VALUES(?,?,?)").run(account.id, org, name);
      this.db
        .prepare("INSERT INTO users(id,email,name,salt,password,createdAt) VALUES(?,?,?,?,?,?)")
        .run(user, email, name, salt, password, Date.now());
      this.db.prepare("INSERT INTO memberships VALUES(?,?,'owner')").run(user, account.id);
      if (this.signupTrial) {
        claimTrial(this.db, org, { ...input, email });
        this.db
          .prepare("UPDATE orgs SET trialEndsAt=? WHERE id=?")
          .run(Date.now() + 14 * 86400000, org);
        this.billing.recordGrant(org, "ai", 30, "trial", "initial-trial");
      } else this.billing.seedPilot(org);
      this.db.exec("COMMIT");
      return this.identity(user, account.id);
    } catch (e) {
      this.db.exec("ROLLBACK");
      if (e.code?.includes("SQLITE_CONSTRAINT") || e.message?.includes("UNIQUE"))
        throw error("This email is already registered. Sign in to its store account.", 409);
      throw e;
    }
  }
  async login(input) {
    const row = this.db.prepare("SELECT * FROM users WHERE email=?").get(emailValue(input.email));
    const password =
      typeof input.password === "string" && input.password.length <= 128 ? input.password : "";
    const hash = await scrypt(password, row?.salt || "forme-missing-account", 64);
    if (!row || row.disabled || !timingSafeEqual(hash, Buffer.from(row.password)))
      throw error("Email or password is incorrect.", 401);
    const membership = storesForUser(this.db, row.id)[0];
    if (!membership) throw error("No store access is available for this user.", 403);
    return this.identity(row.id, membership.id);
  }
  identity(userId, storeId) {
    const membership = storeMembership(this.db, userId, storeId);
    if (!membership) return null;
    const user = this.db
      .prepare("SELECT id,name,email FROM users WHERE id=? AND disabled=0")
      .get(userId);
    return {
      id: membership.id,
      name: membership.name,
      email: user.email,
      user: { id: user.id, name: user.name, role: membership.role },
      org: membership.org,
    };
  }
  session(account) {
    const identity = this.identity(account.user?.id, account.id);
    if (!identity) throw error("Store access is no longer available.", 403);
    const token = randomBytes(32).toString("hex");
    this.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(Date.now());
    this.db
      .prepare("INSERT INTO sessions(token,account,expires,user,store) VALUES(?,?,?,?,?)")
      .run(digest(token), identity.id, Date.now() + lifetime, identity.user.id, identity.id);
    return token;
  }
  user(token) {
    const session = this.db
      .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
      .get(digest(token), Date.now());
    if (!session) return null;
    if (!session.user && !session.store) {
      const owner = this.db
        .prepare(
          `SELECT u.id FROM users u JOIN accounts a ON a.email=u.email
        JOIN memberships m ON m.user=u.id AND m.store=a.id
        WHERE a.id=? AND m.role='owner' AND u.disabled=0`,
        )
        .get(session.account);
      if (!owner) return null;
      this.db
        .prepare(
          "UPDATE sessions SET user=?,store=? WHERE token=? AND user IS NULL AND store IS NULL",
        )
        .run(owner.id, session.account, session.token);
      session.user = owner.id;
      session.store = session.account;
    }
    return this.identity(session.user, session.store);
  }
  switchStore(token, storeId) {
    const current = this.user(token);
    if (!current) throw error("Sign in to your store account.", 401);
    if (typeof storeId !== "string") throw error("Choose a store.");
    const next = this.identity(current.user.id, storeId);
    if (!next) throw error("You do not have access to this store.", 403);
    this.db
      .prepare("UPDATE sessions SET store=?,account=? WHERE token=?")
      .run(storeId, storeId, digest(token));
    return next;
  }
  logout(token) {
    this.db.prepare("DELETE FROM sessions WHERE token=?").run(digest(token));
  }
  async resetPassword(email, password) {
    if (typeof password !== "string" || password.length < 12 || password.length > 128)
      throw error("Use a password between 12 and 128 characters.");
    const user = this.db.prepare("SELECT id FROM users WHERE email=?").get(emailValue(email));
    if (!user) throw error("Account not found.", 404);
    const salt = randomBytes(16).toString("hex"),
      hash = await scrypt(password, salt, 64);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE users SET salt=?,password=? WHERE id=?").run(salt, hash, user.id);
      this.db
        .prepare("UPDATE accounts SET salt=?,password=? WHERE email=?")
        .run(salt, hash, emailValue(email));
      this.db
        .prepare(
          `DELETE FROM sessions WHERE user=? OR (user IS NULL AND account IN
        (SELECT a.id FROM accounts a JOIN memberships m ON m.store=a.id
          WHERE a.email=? AND m.user=? AND m.role='owner'))`,
        )
        .run(user.id, emailValue(email), user.id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  requireRegenerationSource(account, id, customerId) {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
      throw error("Choose an approved avatar to regenerate.");
    const source = this.db
      .prepare(
        "SELECT customer,COALESCE(master_id,id) AS masterId,approved_at,review_policy FROM avatars WHERE account=? AND id=?",
      )
      .get(account.id, id);
    if (!source) throw error("Avatar not found.", 404);
    if (source.customer !== (customerId ?? null))
      throw error("Keep the same customer when regenerating a master avatar.", 409);
    if (!source.approved_at || source.review_policy !== AVATAR_REVIEW_POLICY_VERSION)
      throw error("Review and approve the source avatar before regenerating it.", 409);
    return source.masterId;
  }

  async save(account, input) {
    const { profileId, heightCm, weightKg } = input;
    const templateTone = input.templateTone ?? DEFAULT_TEMPLATE_TONE;
    if (!validTemplateTone(templateTone)) throw error("Choose an available template skin tone.");
    const profileSelection = parseProfileSelection(input.profileSelection);
    if (input.profileSelection != null && !profileSelection)
      throw error("Use a valid profile selection source and comparison.");
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (
      !name ||
      name.length > 60 ||
      !profiles.some((p) => p.id === profileId) ||
      !recommendProfile(heightCm, weightKg, profiles.find((p) => p.id === profileId)?.body) ||
      !["generated", "imported"].includes(input.source)
    )
      throw error("Use a name, body profile and valid measurements.");
    this.customers.requireOptional(account, input.customerId);
    const { image, thumbnail } = await savedImage(input.image);
    const generation = verifyAvatarGenerationReceipt(this.views.key, account, input);
    // Scope deduplication to the customer so identical images cannot move ownership.
    const id = input.customerId
        ? digest(Buffer.concat([image, Buffer.from(input.customerId)]))
        : digest(image),
      savedAt = Date.now();
    return transaction(this.db, () => {
      this.customers.requireOptional(account, input.customerId);
      const existing = this.db
        .prepare(
          "SELECT master_id,master_version,savedAt,approved_at,review_policy,generation_provenance FROM avatars WHERE account=? AND id=?",
        )
        .get(account.id, id);
      let masterId = existing?.master_id ?? null;
      let masterVersion = existing?.master_version ?? 1;
      if (input.regenerateFromId != null) {
        masterId = this.requireRegenerationSource(
          account,
          input.regenerateFromId,
          input.customerId,
        );
        if (existing) {
          const savedGeneration = JSON.parse(existing.generation_provenance ?? "null");
          if (
            existing.master_id !== masterId ||
            savedGeneration?.requestId !== generation.requestId
          )
            throw error(
              "This regenerated image matches a saved avatar. A new master version needs a different image.",
              409,
            );
          const approved =
            existing.approved_at && existing.review_policy === AVATAR_REVIEW_POLICY_VERSION;
          return {
            id,
            savedAt: existing.savedAt,
            masterId,
            masterVersion,
            approvalStatus: approved ? "approved" : "draft",
          };
        }
        masterVersion = this.db
          .prepare(
            `INSERT INTO avatar_master_sequences(account,masterId,last_version)
          VALUES(?,?,2) ON CONFLICT(account,masterId) DO UPDATE SET last_version=last_version+1
          RETURNING last_version`,
          )
          .get(account.id, masterId).last_version;
      }
      const count = this.db
        .prepare("SELECT count(*) AS total FROM avatars WHERE account=?")
        .get(account.id).total;
      if (!existing && count >= 100)
        throw error("Your account holds up to 100 avatars. Delete one before adding another.", 409);
      this.db
        .prepare(
          `INSERT INTO avatars(id,account,name,profileId,heightCm,weightKg,source,savedAt,image,thumbnail,body_type,template_tone,customer,profile_selection,generation_provenance,master_id,master_version)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(account,id) DO UPDATE SET name=excluded.name,profileId=excluded.profileId,heightCm=excluded.heightCm,weightKg=excluded.weightKg,source=excluded.source,savedAt=excluded.savedAt,body_type=excluded.body_type,template_tone=excluded.template_tone,profile_selection=excluded.profile_selection,
           generation_provenance=COALESCE(avatars.generation_provenance,excluded.generation_provenance),approved_at=NULL,approved_by=NULL,review_policy=0,approved_version=NULL`,
        )
        .run(
          id,
          account.id,
          name,
          profileId,
          heightCm,
          weightKg,
          input.source,
          savedAt,
          image,
          thumbnail,
          profiles.find((p) => p.id === profileId).body,
          templateTone,
          input.customerId ?? null,
          profileSelection ? JSON.stringify(profileSelection) : null,
          generation ? JSON.stringify({ ...generation, storedSha256: digest(image) }) : null,
          masterId,
          masterVersion,
        );
      this.views?.invalidate(account.id, id);
      return { id, savedAt, masterId: masterId ?? id, masterVersion, approvalStatus: "draft" };
    });
  }
  approveAvatar(account, id, review) {
    if (!validateAvatarApproval(review))
      throw error("Complete all six quality checks and obtain explicit customer approval.", 400);
    return transaction(this.db, () => {
      const avatar = this.db
        .prepare("SELECT * FROM avatars WHERE account=? AND id=?")
        .get(account.id, id);
      if (!avatar) throw error("Avatar not found.", 404);
      if (
        avatar.approved_version &&
        avatar.approved_at &&
        avatar.review_policy === AVATAR_REVIEW_POLICY_VERSION
      )
        return {
          id,
          approvalStatus: "approved",
          approvedAt: avatar.approved_at,
          version: avatar.approved_version,
        };

      const approvedAt = Date.now();
      const metadata = {
        name: avatar.name,
        profileId: avatar.profileId,
        bodyType: avatar.body_type,
        templateTone: avatar.template_tone,
        heightCm: avatar.heightCm,
        weightKg: avatar.weightKg,
        source: avatar.source,
        savedAt: avatar.savedAt,
        profileSelection: avatar.profile_selection ? JSON.parse(avatar.profile_selection) : null,
        generation: avatar.generation_provenance ? JSON.parse(avatar.generation_provenance) : null,
      };
      const { version } = this.db
        .prepare(
          `INSERT INTO avatar_versions(account,avatarId,version,image_sha256,metadata,approved_at,approved_by,review_policy)
          VALUES(?,?,(SELECT COALESCE(MAX(version),0)+1 FROM avatar_versions WHERE account=? AND avatarId=?),?,?,?,?,?)
          RETURNING version`,
        )
        .get(
          account.id,
          id,
          account.id,
          id,
          digest(avatar.image),
          JSON.stringify(metadata),
          approvedAt,
          account.user.id,
          AVATAR_REVIEW_POLICY_VERSION,
        );
      this.db
        .prepare(
          "UPDATE avatars SET approved_at=?,approved_by=?,review_policy=?,approved_version=? WHERE account=? AND id=?",
        )
        .run(approvedAt, account.user.id, AVATAR_REVIEW_POLICY_VERSION, version, account.id, id);
      return { id, approvalStatus: "approved", approvedAt, version };
    });
  }
  revokeAvatarApproval(account, id) {
    const changed = this.db
      .prepare(
        "UPDATE avatars SET approved_at=NULL,approved_by=NULL,review_policy=0,approved_version=NULL WHERE account=? AND id=?",
      )
      .run(account.id, id);
    if (!changed.changes) throw error("Avatar not found.", 404);
    this.views?.invalidate(account.id, id);
    return { id, approvalStatus: "draft" };
  }
  requireApprovedAvatar(account, id) {
    this.requireAvatar(account, id);
    const row = this.db
      .prepare("SELECT approved_at,review_policy FROM avatars WHERE account=? AND id=?")
      .get(account.id, id);
    if (!row.approved_at || row.review_policy !== AVATAR_REVIEW_POLICY_VERSION)
      throw error("This avatar needs customer and quality review before it can be reused.", 409);
  }
  avatarVersions(account, id, before) {
    const upperBound = before === undefined ? Number.MAX_SAFE_INTEGER : Number(before);
    if (
      (before !== undefined && (typeof before !== "string" || !/^\d+$/.test(before))) ||
      !Number.isSafeInteger(upperBound) ||
      upperBound < 1
    )
      throw error("Use a valid avatar version number.");
    this.requireAvatar(account, id);
    const rows = this.db
      .prepare(
        `SELECT v.version,v.image_sha256 AS imageSha256,v.metadata,v.approved_at AS approvedAt,
        v.approved_by AS approvedBy,v.review_policy AS reviewPolicy,
        COALESCE(a.approved_version=v.version AND a.review_policy=?,0) AS current
        FROM avatar_versions v JOIN avatars a ON a.account=v.account AND a.id=v.avatarId
        WHERE v.account=? AND v.avatarId=? AND v.version<? ORDER BY v.version DESC LIMIT ?`,
      )
      .all(AVATAR_REVIEW_POLICY_VERSION, account.id, id, upperBound, avatarVersionsPageSize + 1);
    const versions = rows.slice(0, avatarVersionsPageSize).map(({ metadata, current, ...row }) => ({
      ...row,
      ...JSON.parse(metadata),
      current: Boolean(current),
    }));
    return {
      versions,
      nextBefore: rows.length > avatarVersionsPageSize ? versions.at(-1).version : null,
    };
  }
  list(account) {
    return this.db
      .prepare(
        "SELECT id,name,customer AS customerId,(SELECT name FROM customers c WHERE c.store=avatars.account AND c.id=avatars.customer) AS customerName,(SELECT phoneE164 FROM customers c WHERE c.store=avatars.account AND c.id=avatars.customer) AS customerPhone,profileId,body_type AS bodyType,template_tone AS templateTone,heightCm,weightKg,source,savedAt,thumbnail,profile_selection,generation_provenance,COALESCE(master_id,id) AS masterId,master_version AS masterVersion,approved_version AS approvedVersion,(SELECT max(v.version) FROM avatar_versions v WHERE v.account=avatars.account AND v.avatarId=avatars.id) AS latestVersion,CASE WHEN approved_at IS NOT NULL AND review_policy=1 THEN 'approved' ELSE 'draft' END AS approvalStatus,(SELECT count(*) FROM looks l WHERE l.account=avatars.account AND l.avatarId=avatars.id) AS looksCount FROM avatars WHERE account=? ORDER BY savedAt DESC",
      )
      .all(account.id)
      .map(({ profile_selection, generation_provenance, ...row }) => ({
        ...row,
        profileSelection: profile_selection ? JSON.parse(profile_selection) : null,
        generation: generation_provenance ? JSON.parse(generation_provenance) : null,
        thumbnail: `data:image/png;base64,${Buffer.from(row.thumbnail).toString("base64")}`,
      }));
  }
  async saveLook(
    account,
    input,
    { view = "full", itemsJson = [], previewMode = "ai", handsGeometry = null, guard } = {},
  ) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (
      !name ||
      name.length > 60 ||
      !Array.isArray(input.garments) ||
      input.garments.length > (view === "complete" ? 20 : 10) ||
      input.garments.some((x) => typeof x !== "string" || !x.trim() || x.length > 120)
    )
      throw error("Use a look name and up to 10 garment labels of at most 120 characters.");
    this.requireApprovedAvatar(account, input.avatarId);
    validateLookTracking(this, account, input);
    const { image, thumbnail } = await savedImage(input.image, view);
    // Recheck after decoding: the avatar may have been revoked or deleted meanwhile.
    this.requireApprovedAvatar(account, input.avatarId);
    return transaction(this.db, () => {
      guard?.();
      validateLookTracking(this, account, input);
      const id = digest(Buffer.concat([image, Buffer.from(input.avatarId)])),
        savedAt = Date.now();
      const exists = this.db
        .prepare("SELECT id FROM looks WHERE account=? AND id=?")
        .get(account.id, id);
      if (
        !exists &&
        this.db.prepare("SELECT count(*) AS total FROM looks WHERE account=?").get(account.id)
          .total >= 200
      )
        throw error("Your account holds up to 200 looks. Delete one before adding another.", 409);
      this.db
        .prepare(
          `INSERT INTO looks(id,account,avatarId,name,garments,image,thumbnail,savedAt,view,itemsJson,previewMode,handsGeometryJson) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,id) DO UPDATE SET avatarId=excluded.avatarId,name=excluded.name,garments=excluded.garments,savedAt=excluded.savedAt,view=excluded.view,itemsJson=excluded.itemsJson,previewMode=excluded.previewMode,handsGeometryJson=excluded.handsGeometryJson`,
        )
        .run(
          id,
          account.id,
          input.avatarId,
          name,
          JSON.stringify(input.garments),
          image,
          thumbnail,
          savedAt,
          view,
          JSON.stringify(itemsJson),
          previewMode,
          handsGeometry ? JSON.stringify(handsGeometry) : null,
        );
      attributeLook(this, account, id, input);
      return { id, avatarId: input.avatarId, savedAt };
    });
  }
  requireAvatar(account, id) {
    if (
      typeof id !== "string" ||
      !this.db.prepare("SELECT id FROM avatars WHERE account=? AND id=?").get(account.id, id)
    )
      throw error("Avatar not found.", 404);
  }
  listLooks(account, avatarId) {
    if (avatarId !== undefined) this.requireAvatar(account, avatarId);
    const rows =
      avatarId === undefined
        ? this.db
            .prepare(
              "SELECT id,avatarId,name,garments,thumbnail,savedAt,purchasedAt,purchasedSize,staffUser,view,itemsJson,previewMode FROM looks WHERE account=? ORDER BY savedAt DESC",
            )
            .all(account.id)
        : this.db
            .prepare(
              "SELECT id,avatarId,name,garments,thumbnail,savedAt,purchasedAt,purchasedSize,staffUser,view,itemsJson,previewMode FROM looks WHERE account=? AND avatarId=? ORDER BY savedAt DESC",
            )
            .all(account.id, avatarId);
    return rows.map((row) => ({
      ...row,
      ...lookAttribution(this, account, row.id),
      itemsJson: JSON.parse(row.itemsJson),
      garments: JSON.parse(row.garments),
      thumbnail: `data:image/png;base64,${Buffer.from(row.thumbnail).toString("base64")}`,
    }));
  }
  lookImage(account, id) {
    const row = this.db
      .prepare("SELECT image FROM looks WHERE account=? AND id=?")
      .get(account.id, id);
    return row ? Buffer.from(row.image) : null;
  }
  removeLook(account, id) {
    return (
      this.db.prepare("DELETE FROM looks WHERE account=? AND id=?").run(account.id, id).changes > 0
    );
  }
  image(account, id) {
    const row = this.db
      .prepare("SELECT image FROM avatars WHERE account=? AND id=?")
      .get(account.id, id);
    return row ? Buffer.from(row.image) : null;
  }
  remove(account, id) {
    this.views?.invalidate(account.id, id);
    return (
      this.db.prepare("DELETE FROM avatars WHERE account=? AND id=?").run(account.id, id).changes >
      0
    );
  }
}

function token(req) {
  return (
    (req.get("cookie") || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1) || ""
  );
}
export function accountUser(store, req) {
  return store?.user(token(req)) || null;
}
export function installAccountRoutes(
  app,
  store,
  {
    production = false,
    allowSignup = true,
    sendMail,
    publicUrl,
    payments,
    whatsapp,
    campaignConfig,
    catalogueOptions,
    analyticsReports,
    catalogueSync,
    photoJobs,
    shopifyShopper,
    jewelleryEnabled = false,
  } = {},
) {
  const attempts = new Map();
  let hashes = 0;
  const cookie = (res, value, maxAge = lifetime) =>
    res.cookie(cookieName, value, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/",
      maxAge,
    });
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      res.status(e.status || 500).json({
        error: e.status
          ? e.message
          : "Account storage is unavailable. Please try again; no generation request was retried.",
      });
    }
  };
  const sameOrigin = (req, res, next) => {
    try {
      const origin = new URL(req.get("origin"));
      if (origin.host === req.get("host") && origin.protocol === `${req.protocol}:`) return next();
    } catch {}
    return res.status(403).json({ error: "Open account actions from this studio website." });
  };
  const requireUser = (req, res, next) => {
    req.account = accountUser(store, req);
    if (!req.account) return res.status(401).json({ error: "Sign in to your store account." });
    next();
  };
  const response = (account) => ({
    account,
    user: account?.user || null,
    role: account?.user.role || null,
    stores: account ? storesForUser(store.db, account.user.id) : [],
  });
  app.get(
    "/api/account",
    wrap((req, res) =>
      res.json({
        enabled: Boolean(store),
        signupAllowed: Boolean(store && allowSignup),
        ...response(accountUser(store, req)),
      }),
    ),
  );
  if (!store) return;
  installShopperBudgetRoutes(app, store, { requireUser, sameOrigin, wrap });
  installShopifyShopperOwner(app, shopifyShopper, { requireUser, sameOrigin, wrap, production });
  installBrandingRoutes(app, store, { requireUser, sameOrigin, wrap });
  installShopPageRoutes(app, store, {
    requireUser,
    sameOrigin,
    wrap,
    viewer: (req) => accountUser(store, req),
  });
  installAnalyticsRoutes(app, store, {
    requireUser,
    sameOrigin,
    wrap,
    reports: analyticsReports,
    jewelleryEnabled,
  });
  if (catalogueSync)
    installSyncRoutes(app, store, catalogueSync, { requireUser, sameOrigin, wrap });
  if (photoJobs) installPhotoRoutes(app, store, photoJobs, { requireUser, sameOrigin, wrap });
  installSizeRoutes(app, store, { requireUser, sameOrigin, wrap });
  installCatalogueRoutes(app, store, {
    requireUser,
    sameOrigin,
    wrap,
    options: catalogueOptions,
    jewelleryEnabled,
  });
  if (whatsapp && campaignConfig)
    installCampaignRoutes(app, store, whatsapp, campaignConfig, { requireUser, sameOrigin, wrap });
  if (whatsapp) installWhatsAppRoutes(app, store, whatsapp, { requireUser, sameOrigin, wrap });
  installShareRoutes(app, store, { requireUser, sameOrigin, wrap, publicUrl });
  installCustomerRoutes(app, store, { requireUser, sameOrigin, wrap });
  installBillingRoutes(app, store, { requireUser, sameOrigin, wrap, payments });
  installStaffRoutes(app, store, {
    sameOrigin,
    requireUser,
    wrap,
    production,
    sendMail,
    publicUrl,
  });
  for (const action of ["register", "login"])
    app.post(
      `/api/account/${action}`,
      sameOrigin,
      wrap(async (req, res) => {
        const key = `${action}:${req.ip}`,
          now = Date.now();
        let entry = attempts.get(key);
        if (!entry || now - entry.started > 15 * 60 * 1000) entry = { started: now, count: 0 };
        if (entry.count >= 10 || hashes >= 2)
          throw error("Too many sign-in attempts. Please wait before trying again.", 429);
        entry.count++;
        if (attempts.size > 2000) attempts.delete(attempts.keys().next().value);
        attempts.set(key, entry);
        if (action === "register" && !allowSignup)
          throw error(
            "Account registration is disabled. Ask the store administrator for access.",
            403,
          );
        hashes++;
        try {
          const account = await store[action](req.body || {});
          store.logout(token(req));
          cookie(res, store.session(account));
          res.json(response(account));
        } finally {
          hashes--;
        }
      }),
    );
  app.post(
    "/api/auth/switch-store",
    sameOrigin,
    requireUser,
    requireRole("owner", "manager", "staff"),
    wrap((req, res) => {
      res.json(response(store.switchStore(token(req), req.body?.storeId)));
    }),
  );
  app.post(
    "/api/account/logout",
    sameOrigin,
    wrap((req, res) => {
      store.logout(token(req));
      cookie(res, "", 0);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/looks",
    requireUser,
    wrap((req, res) => res.json({ looks: store.listLooks(req.account, req.query.avatar) })),
  );
  app.get(
    "/api/looks/:id/image",
    requireUser,
    wrap((req, res) => {
      const image = store.lookImage(req.account, req.params.id);
      if (!image) throw error("Look not found.", 404);
      res.type("png").send(image);
    }),
  );
  app.post(
    "/api/looks",
    sameOrigin,
    requireUser,
    wrap(async (req, res) => {
      if (req.body?.storageConsent !== true)
        throw error("Confirm customer agreement before saving this look to the store account.");
      res.json(await store.saveLook(req.account, req.body));
    }),
  );
  app.delete(
    "/api/looks/:id",
    sameOrigin,
    requireUser,
    wrap((req, res) => {
      if (!store.removeLook(req.account, req.params.id)) throw error("Look not found.", 404);
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/avatars",
    requireUser,
    wrap((req, res) => res.json({ avatars: store.list(req.account) })),
  );
  app.get(
    "/api/avatars/:id/image",
    requireUser,
    wrap((req, res) => {
      const image = store.image(req.account, req.params.id);
      if (!image) throw error("Avatar not found.", 404);
      res.type("png").send(image);
    }),
  );
  app.get(
    "/api/avatars/:id/versions",
    requireUser,
    wrap((req, res) =>
      res.json(store.avatarVersions(req.account, req.params.id, req.query.before)),
    ),
  );
  app.post(
    "/api/avatars",
    sameOrigin,
    requireUser,
    wrap(async (req, res) => {
      if (req.body.storageConsent !== true)
        throw error("Confirm customer agreement before saving to the store account.");
      res.json(await store.save(req.account, req.body));
    }),
  );
  app.post(
    "/api/avatars/:id/approval",
    sameOrigin,
    requireUser,
    requireRole("owner", "manager", "staff"),
    wrap((req, res) => res.json(store.approveAvatar(req.account, req.params.id, req.body))),
  );
  app.delete(
    "/api/avatars/:id/approval",
    sameOrigin,
    requireUser,
    requireRole("owner", "manager", "staff"),
    wrap((req, res) => res.json(store.revokeAvatarApproval(req.account, req.params.id))),
  );
  app.delete(
    "/api/avatars/:id",
    sameOrigin,
    requireUser,
    wrap((req, res) => {
      if (!store.remove(req.account, req.params.id)) throw error("Avatar not found.", 404);
      res.json({ ok: true });
    }),
  );
}
