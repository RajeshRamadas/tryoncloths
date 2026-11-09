export function installWhatsAppSchema(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(customers)")
        .all()
        .map((c) => c.name),
    );
    if (!columns.has("whatsappConsentAt"))
      db.exec("ALTER TABLE customers ADD COLUMN whatsappConsentAt INTEGER");
    if (!columns.has("whatsappConsentSource"))
      db.exec("ALTER TABLE customers ADD COLUMN whatsappConsentSource TEXT");
    db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_integrations (
   store TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE, phoneId TEXT NOT NULL UNIQUE,
   wabaId TEXT NOT NULL, token TEXT NOT NULL, language TEXT NOT NULL, connectedAt INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS whatsapp_books (
    hash TEXT PRIMARY KEY,store TEXT NOT NULL,customer TEXT NOT NULL,expiresAt INTEGER NOT NULL,
    FOREIGN KEY(store,customer) REFERENCES customers(store,id) ON DELETE CASCADE);
   CREATE TABLE IF NOT EXISTS whatsapp_book_looks (
    book TEXT NOT NULL REFERENCES whatsapp_books(hash) ON DELETE CASCADE,store TEXT NOT NULL,look TEXT NOT NULL,position INTEGER NOT NULL,
    PRIMARY KEY(book,look),FOREIGN KEY(store,look) REFERENCES looks(account,id) ON DELETE CASCADE);
   CREATE TRIGGER IF NOT EXISTS whatsapp_look_erasure BEFORE DELETE ON looks BEGIN
    DELETE FROM whatsapp_books WHERE hash IN (SELECT book FROM whatsapp_book_looks WHERE store=OLD.account AND look=OLD.id); END;
   CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,store TEXT NOT NULL,customer TEXT NOT NULL,requestId TEXT NOT NULL,
    template TEXT NOT NULL,state TEXT NOT NULL,providerId TEXT UNIQUE,delivery TEXT,book TEXT REFERENCES whatsapp_books(hash) ON DELETE SET NULL,
    createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL,UNIQUE(store,requestId),
    FOREIGN KEY(store,customer) REFERENCES customers(store,id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS whatsapp_marketing ON whatsapp_messages(store,customer,template,createdAt);
   CREATE TABLE IF NOT EXISTS whatsapp_delivery (
    store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,providerId TEXT NOT NULL,status TEXT NOT NULL,receivedAt INTEGER NOT NULL,
    PRIMARY KEY(store,providerId));
   CREATE TABLE IF NOT EXISTS whatsapp_inbound (id TEXT PRIMARY KEY,receivedAt INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
    id TEXT PRIMARY KEY,store TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,createdAt INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS whatsapp_campaign_items (
    id TEXT PRIMARY KEY,campaign TEXT NOT NULL REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,store TEXT NOT NULL,
    customer TEXT NOT NULL,avatar TEXT NOT NULL,garment TEXT NOT NULL,state TEXT NOT NULL,look TEXT,requestId TEXT NOT NULL,
    FOREIGN KEY(store,customer) REFERENCES customers(store,id) ON DELETE CASCADE,
    FOREIGN KEY(store,avatar) REFERENCES avatars(account,id) ON DELETE CASCADE,
    FOREIGN KEY(store,garment) REFERENCES garments(account,id) ON DELETE CASCADE,
    FOREIGN KEY(store,look) REFERENCES looks(account,id) ON DELETE CASCADE);`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
