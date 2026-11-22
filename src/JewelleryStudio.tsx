import TryOnTabs from "./TryOnTabs";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Undo2, Download, Search, Gem } from "lucide-react";
import JewellerySizeHelp from "./JewellerySizeHelp";
import JewelleryNecklaceGuide from "./JewelleryNecklaceGuide";
import JewelleryCompare from "./JewelleryCompare";
import JewelleryOverlay, { type OverlayPrepared, type OverlayPlacement } from "./JewelleryOverlay";
import {
  overlayAnchors,
  overlayRegions,
  previewLabel,
  refineEarringPlacements,
  refineFullBodyPlacements,
} from "./jewellery-overlay";
import AvatarViews from "./AvatarViews";
import ShareLook from "./ShareLook";
import { readPhoto } from "./images";
import { automaticJewelleryCutout } from "./jewellery-cutout-photo";
import { readProductPhotos, type ProductPhoto } from "./product-photos";
import {
  jewelleryTypes,
  jewelleryChoices,
  jewelleryMetals,
  bangleSizes,
  jewelleryView,
  guessJewelleryType,
  type JewelleryType,
  type JewelleryAttributes,
} from "./jewellery-types";
import {
  jewelleryApi,
  imageData,
  downloadJewellery,
  scaleNote,
  regions,
  type View,
  type JewelleryItem,
  type JewelleryResult,
  type Piece,
  type PreviewMode,
} from "./jewellery-api";

type Avatar = { id: string; name: string; bodyType: string; templateTone: string };
type Draft = {
  name: string;
  type: JewelleryType | null;
  attributes: JewelleryAttributes;
  image: string;
  item: JewelleryItem | null;
  url: string;
  cutout?: { png: string; error?: never } | { png?: never; error: string };
};
type Frame = {
  image: string;
  items: Piece[];
  result?: JewelleryResult;
  baseLookId?: string;
  saved?: boolean;
  previewMode?: PreviewMode;
  sourceApproval?: JewelleryResult["sourceApproval"];
  closeUps?: { label: string; x: number; y: number }[];
};
const emptyDraft = (): Draft => ({
  name: "",
  type: null,
  attributes: { metal: "" },
  image: "",
  item: null,
  url: "",
});
const savedDraft = (item: JewelleryItem): Draft => ({
  item,
  image: item.image || "",
  name: item.name,
  type: item.garmentType,
  attributes: item.attributes,
  url: item.sourceUrl,
});
const emptyFrames = (): Record<View, Frame[]> => ({ portrait: [], hands: [], full: [] });
const viewNames: Record<View, string> = { portrait: "Portrait", hands: "Hands", full: "Full body" };
const longNecklaces = ["necklace", "pendant", "mangalsutra"];

export default function JewelleryStudio() {
  const [source, setSource] = useState<"saved" | "photo" | "link">("saved");
  const [mode, setMode] = useState<"ai" | "overlay">("ai"),
    [overlayEnabled, setOverlayEnabled] = useState(false),
    [rootRevision, setRootRevision] = useState(0);
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [generation, setGeneration] = useState(false),
    [bodies, setBodies] = useState<string[]>(["male"]),
    [role, setRole] = useState("");
  const [avatars, setAvatars] = useState<Avatar[]>([]),
    [avatar, setAvatar] = useState(""),
    [view, setView] = useState<View>("portrait"),
    [roots, setRoots] = useState<Partial<Record<View, string>>>({}),
    [history, setHistory] = useState(emptyFrames);
  const [draft, setDraft] = useState(emptyDraft),
    [typeConfirmed, setTypeConfirmed] = useState(false),
    [photos, setPhotos] = useState<ProductPhoto[]>([]),
    [url, setUrl] = useState(""),
    [matches, setMatches] = useState<JewelleryItem[]>([]);
  const [search, setSearch] = useState(""),
    [filterType, setFilterType] = useState("all"),
    [metal, setMetal] = useState("all"),
    [items, setItems] = useState<JewelleryItem[]>([]),
    [total, setTotal] = useState(0),
    [offset, setOffset] = useState(0);
  const [side, setSide] = useState("left"),
    [hand, setHand] = useState("right"),
    [finger, setFinger] = useState("ring"),
    [wrist, setWrist] = useState("left"),
    [count, setCount] = useState(1),
    [replace, setReplace] = useState(false);
  const [reviewed, setReviewed] = useState(false),
    [consent, setConsent] = useState(false),
    [storage, setStorage] = useState(false),
    [lookName, setLookName] = useState("Customer jewellery look"),
    [savedLook, setSavedLook] = useState<{ id: string; image: string } | null>(null);
  const [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(false),
    [preparing, setPreparing] = useState(false),
    [zoom, setZoom] = useState(1),
    [zoomFocus, setZoomFocus] = useState<{ resultId: string; x: number; y: number } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const fittingSession = useRef(crypto.randomUUID());
  const preview = useRef<HTMLDivElement>(null);
  const alive = useRef(true),
    epoch = useRef(0),
    controller = useRef<AbortController | null>(null),
    identity = useRef(""),
    lookQuery = useRef(new URLSearchParams(location.search).get("look"));
  const selected = avatars.find((a) => a.id === avatar),
    frames = history[view],
    current = frames.at(-1),
    activeResultId = current?.result?.resultId,
    image = current?.image || roots[view] || "",
    type = draft.type,
    definition = type ? jewelleryTypes[type] : null;
  const manager = role === "owner" || role === "manager",
    available = generation && bodies.includes(selected?.bodyType || "male");
  const valid = (version: number) => alive.current && epoch.current === version;
  useEffect(() => {
    const frame = preview.current;
    const photo = frame?.querySelector("img");
    if (!frame || !photo || !zoomFocus || zoomFocus.resultId !== activeResultId || zoom === 1)
      return;
    const { x, y } = zoomFocus;
    function centrePhoto() {
      if (!photo?.naturalWidth || !photo.naturalHeight || !frame) return;
      // Match the preview's top-centred object-fit: contain.
      const scale = Math.min(
        photo.clientWidth / photo.naturalWidth,
        photo.clientHeight / photo.naturalHeight,
      );
      const width = photo.naturalWidth * scale;
      frame.scrollTo(
        (photo.clientWidth - width) / 2 + x * width - frame.clientWidth / 2,
        y * photo.naturalHeight * scale - frame.clientHeight / 2,
      );
    }
    if (photo.complete) centrePhoto();
    else photo.addEventListener("load", centrePhoto, { once: true });
    return () => photo.removeEventListener("load", centrePhoto);
  }, [activeResultId, zoom, zoomFocus]);
  const clearReview = () => {
    setConsent(false);
    setStorage(false);
  };
  function clearPrivate() {
    epoch.current++;
    controller.current?.abort();
    setBusy("");
    setLoading(false);
    setPreparing(false);
    setRoots({});
    setHistory(emptyFrames());
    setDraft(emptyDraft());
    setPhotos([]);
    setMatches([]);
    setItems([]);
    setAvatars([]);
    setAvatar("");
    setRole("");
    setReviewed(false);
    clearReview();
    setSavedLook(null);
    setLookName("Customer jewellery look");
    setUrl("");
    setSearch("");
    setSource("saved");
    setNotice("");
    identity.current = "";
  }
  useEffect(() => {
    alive.current = true;
    let mounted = true;
    const boot = epoch.current;
    const expired = () => {
      clearPrivate();
      setError("Your store session ended or changed. Sign in from Forme and reopen this studio.");
    };
    const resume = () => {
      if (document.visibilityState !== "visible" || !identity.current) return;
      void jewelleryApi("/api/account")
        .then((d) => {
          if (
            mounted &&
            identity.current &&
            d.account?.id + ":" + d.account?.user?.id !== identity.current
          )
            expired();
        })
        .catch(() => {
          if (mounted) expired();
        });
    };
    window.addEventListener("forme-account-expired", expired);
    window.addEventListener("focus", resume);
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    void (async () => {
      try {
        const health = await jewelleryApi("/api/health");
        if (!mounted || epoch.current !== boot) return;
        setEnabled(health.jewelleryCatalogueAvailable === true);
        setOverlayEnabled(health.jewelleryOverlayAvailable === true);
        if (!health.jewelleryAvailable && health.jewelleryOverlayAvailable) setMode("overlay");
        setGeneration(
          health.jewelleryAvailable === true && health.jewelleryContract === "jewellery-tryon-v1",
        );
        setBodies(health.supportedBodies || ["male"]);
        if (!health.jewelleryCatalogueAvailable) return;
        const account = await jewelleryApi("/api/account");
        if (!account.account) throw new Error("Sign in from Forme to use your saved avatars.");
        const data = await jewelleryApi("/api/avatars");
        if (!mounted || epoch.current !== boot) return;
        identity.current = account.account.id + ":" + account.account.user.id;
        setRole(account.account.user.role);
        setAvatars(data.avatars);
        const requested = new URLSearchParams(location.search).get("avatar"),
          first = data.avatars.find((a: Avatar) => a.id === requested) || data.avatars[0];
        if (first) setAvatar(first.id);
      } catch (e) {
        if (mounted) setError((e as Error).message);
      }
    })();
    return () => {
      mounted = false;
      alive.current = false;
      epoch.current++;
      controller.current?.abort();
      window.removeEventListener("forme-account-expired", expired);
      window.removeEventListener("focus", resume);
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  useEffect(() => {
    if (!avatar) return;
    fittingSession.current = crypto.randomUUID();
    const version = ++epoch.current,
      abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setRoots({});
    void (async () => {
      try {
        const list = await jewelleryApi(
          "/api/avatars/" + encodeURIComponent(avatar) + "/views",
          undefined,
          abort.signal,
        );
        const pairs = await Promise.all(
          (
            [
              ["full", "/api/avatars/" + encodeURIComponent(avatar) + "/image"],
              ...list.views.map((v: { kind: string }) => [
                v.kind,
                "/api/avatars/" + encodeURIComponent(avatar) + "/views/" + v.kind,
              ]),
            ] as [View, string][]
          ).map(async ([kind, path]) => [kind, await imageData(path, abort.signal)]),
        );
        if (valid(version)) setRoots(Object.fromEntries(pairs));
        if (lookQuery.current) {
          const look = await jewelleryApi(
            "/api/jewellery/looks/" + encodeURIComponent(lookQuery.current),
            undefined,
            abort.signal,
          );
          if (look.avatarId !== avatar)
            throw new Error("This saved look belongs to a different avatar.");
          if (valid(version)) {
            setView(look.view);
            setHistory((h) => ({
              ...h,
              [look.view]: [
                {
                  image: look.image,
                  items: look.itemsJson,
                  baseLookId: look.id,
                  previewMode: look.previewMode,
                  sourceApproval: look.sourceApproval,
                },
              ],
            }));
            setLookName(look.name);
            setSavedLook({ id: look.id, image: look.image });
          }
          lookQuery.current = null;
        }
      } catch (e) {
        if (valid(version)) setError((e as Error).message);
      } finally {
        if (valid(version)) {
          setLoading(false);
          controller.current = null;
        }
      }
    })();
    return () => abort.abort();
  }, [avatar]);
  useEffect(() => {
    if (!enabled || !role) return;
    let mounted = true;
    void jewelleryApi("/api/catalogue?category=jewellery&limit=12")
      .then((d) => {
        if (mounted) {
          setItems(d.garments);
          setTotal(d.total);
        }
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, [enabled, role]);
  function begin(label: string) {
    const version = ++epoch.current,
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(label);
    setError("");
    setNotice("");
    return { version, abort };
  }
  function finish(version: number) {
    if (valid(version)) {
      setBusy("");
      controller.current = null;
    }
  }
  function chooseAvatar(id: string) {
    setRoots({});
    setLoading(true);
    epoch.current++;
    controller.current?.abort();
    lookQuery.current = null;
    setPreparing(false);
    setHistory(emptyFrames());
    setSavedLook(null);
    setDraft(emptyDraft());
    setPhotos([]);
    setMatches([]);
    setReviewed(false);
    clearReview();
    setError("");
    setNotice("");
    setAvatar(id);
  }
  function chooseView(next: View) {
    if (view === next) return;
    setView(next);
    setPreparing(false);
    setZoom(1);
    setReviewed(false);
    clearReview();
    setSavedLook(null);
    setNotice("");
    if (
      type &&
      next !== jewelleryView(type, draft.attributes.lengthCm) &&
      !longNecklaces.includes(type)
    )
      setDraft(emptyDraft());
  }
  function applyDraft(next: Draft) {
    setDraft(next);
    setTypeConfirmed(Boolean(next.item));
    setSide(
      (next.attributes.pair ?? (next.type ? jewelleryTypes[next.type].pair : false))
        ? "both"
        : "left",
    );
    setWrist("left");
    setHand("right");
    setFinger("ring");
    setCount(next.attributes.count || 1);
    setReplace(false);
    setConsent(false);
    setStorage(false);
    setMatches([]);
    if (next.type) {
      const nextView = jewelleryView(next.type, next.attributes.lengthCm) as View;
      if (nextView !== view) {
        setView(nextView);
        setReviewed(false);
        setZoom(1);
      }
    }
  }
  async function chooseItem(item: JewelleryItem) {
    const { version, abort } = begin("Loading jewellery");
    try {
      const result = await jewelleryApi(
        "/api/garments/" + encodeURIComponent(item.id) + "?category=jewellery",
        undefined,
        abort.signal,
      );
      if (valid(version)) {
        applyDraft(savedDraft(result.garment));
        setPhotos([]);
        setNotice("Saved jewellery selected. No AI credit used.");
      }
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  async function browse(page = 0) {
    const { version, abort } = begin("Searching jewellery");
    try {
      const q = new URLSearchParams({
          category: "jewellery",
          search,
          type: filterType,
          metal,
          stock: "available",
          offset: String(page),
          limit: "12",
        }),
        data = await jewelleryApi("/api/catalogue?" + q, undefined, abort.signal);
      if (valid(version)) {
        setItems(data.garments);
        setTotal(data.total);
        setOffset(data.offset);
      }
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  async function readLink(force = false) {
    if (!url.trim()) return;
    const { version, abort } = begin("Reading product photos");
    try {
      if (!force) {
        const found = await jewelleryApi(
          "/api/garments/match",
          { category: "jewellery", url: url.trim() },
          abort.signal,
        );
        if (!valid(version)) return;
        if (found.linked.length) {
          setMatches(found.linked);
          setNotice("Choose the saved product and variant below, or read the website again.");
          return;
        }
      }
      const data = await readProductPhotos(url, abort.signal);
      if (valid(version)) {
        setPhotos(data.images);
        const guessed = guessJewelleryType(data.title);
        applyDraft({
          name: data.title.slice(0, 100),
          type: guessed,
          attributes: { metal: "", pair: guessed ? jewelleryTypes[guessed].pair : false },
          image: data.images[0].image,
          item: null,
          url: data.url,
        });
      }
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  async function upload(file: File) {
    const { version, abort } = begin("Opening product photo");
    try {
      const prepareCutout = overlayEnabled && manager;
      const [photo, cutout] = await Promise.all([
        readPhoto(file),
        prepareCutout
          ? automaticJewelleryCutout(file).then(
              (png) => ({ png }),
              (e: Error) => ({ error: e.message }),
            )
          : undefined,
      ]);
      const name = file.name.replace(/\.[^.]+$/, "").slice(0, 100),
        guessed = guessJewelleryType(name);
      if (!valid(version)) return;
      applyDraft({
        name,
        type: guessed,
        attributes: { metal: "", pair: guessed ? jewelleryTypes[guessed].pair : false },
        image: photo,
        item: null,
        url: "",
        cutout,
      });
      if (cutout && "png" in cutout) {
        setMode("overlay");
        setReplace(false);
      }
      setPhotos([]);
      const found = await jewelleryApi(
        "/api/garments/match",
        { category: "jewellery", image: photo },
        abort.signal,
      );
      if (valid(version)) setMatches([...found.exact, ...found.linked, ...found.similar]);
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  function attribute(key: keyof JewelleryAttributes, value: string | boolean) {
    if (key === "lengthCm" && type) {
      const next = jewelleryView(type, Number(value) || undefined) as View;
      if (next !== view) {
        setView(next);
        setReviewed(false);
      }
    }
    setDraft((d) => ({
      ...d,
      attributes: {
        ...d.attributes,
        [key]:
          typeof value === "boolean"
            ? value
            : value === ""
              ? undefined
              : ["lengthCm", "dropMm", "pendantMm", "ringSizeIn", "weightG"].includes(key)
                ? Number(value)
                : value,
      },
    }));
    setConsent(false);
  }
  const attrs = { ...draft.attributes, ...(type === "bangles" ? { count } : {}) };
  const placement = type
    ? {
        ...(definition!.needsFinger
          ? { hand, finger }
          : definition!.needsWrist
            ? { wrist }
            : definition!.sides.length
              ? { side }
              : {}),
        replaceExisting: replace ? regions[type] : false,
      }
    : {};
  const baseProof = current?.baseLookId
    ? { baseLookId: current.baseLookId }
    : current?.result && (current.result.reused || current.saved)
      ? { baseResultId: current.result.resultId }
      : current?.result?.receipt
        ? { baseReceipt: current.result.receipt }
        : null;
  const overlayPayload = (itemId: string) => ({
    avatarId: avatar,
    view,
    sessionId: fittingSession.current,
    ...placement,
    ...(current ? { base: current.image, ...baseProof, baseReviewed: true } : {}),
    itemId,
    ...(type === "bangles" ? { count } : {}),
  });
  async function requestOverlayPlacement(
    item: JewelleryItem,
    { version, abort }: ReturnType<typeof begin>,
  ): Promise<OverlayPrepared | null> {
    const result: OverlayPrepared = await jewelleryApi(
      "/api/jewellery/overlay/prepare",
      overlayPayload(item.id),
      abort.signal,
    );
    if (!valid(version)) return null;
    const earrings = view === "portrait" && overlayAnchors[item.garmentType] === "earlobe";
    if (view !== "full" && !earrings) return result;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(12000)]);
    const detection = earrings
      ? import("./face-photo").then(({ overlayFacePoints }) =>
          overlayFacePoints(result.base, signal),
        )
      : import("./body-pose").then(({ singleBodyPose }) => singleBodyPose(result.base, signal));
    const landmarks = await Promise.race([
      detection.catch(() => null),
      new Promise<null>((resolve) =>
        signal.addEventListener("abort", () => resolve(null), { once: true }),
      ),
    ]);
    if (!valid(version)) return null;
    if (!landmarks) return result;
    const { placements, matched } = earrings
      ? refineEarringPlacements(result.placements, landmarks, result)
      : refineFullBodyPlacements(result.placements, item.garmentType, landmarks, result);
    if (!matched) return result;
    return {
      ...result,
      placements,
      warning:
        matched === placements.length
          ? earrings
            ? "Starting positions use detected ear points. Check the piercings in close-up."
            : "Starting positions follow the avatar’s body landmarks. Check and adjust the placement."
          : "Some pieces use approximate starting positions. Check and adjust each piece.",
    };
  }
  async function prepareOverlay(): Promise<OverlayPrepared | null> {
    if (!draft.item) return null;
    const attempt = begin("Loading overlay placement");
    try {
      return await requestOverlayPlacement(draft.item, attempt);
    } catch (e) {
      if (valid(attempt.version)) setError((e as Error).message);
      return null;
    } finally {
      finish(attempt.version);
    }
  }
  async function renderOverlayPreview(
    item: JewelleryItem,
    prepared: OverlayPrepared,
    placements: OverlayPlacement[],
    { version, abort }: ReturnType<typeof begin>,
  ) {
    const result: JewelleryResult = await jewelleryApi(
      "/api/jewellery/overlay",
      {
        ...overlayPayload(item.id),
        assetHash: prepared.assetHash,
        placements,
        requestId: crypto.randomUUID(),
      },
      abort.signal,
    );
    if (!valid(version)) return false;
    if (result.view !== view || !result.image?.startsWith("data:image/png;base64,"))
      throw new Error("The studio returned an unsupported overlay preview.");
    const piece: Piece = {
      itemId: item.id,
      name: item.name,
      type: item.garmentType,
      attributes: attrs,
      ...placement,
      mode: "overlay",
      resultId: result.resultId,
    };
    const placementCloseUps: NonNullable<Frame["closeUps"]> = overlayRegions(
      placements,
      overlayAnchors[piece.type],
    ).map(({ label, index }: { label: string; index: number }) => ({
      label,
      x: placements[index].x / prepared.width,
      y: placements[index].y / prepared.height,
    }));
    const closeUps = [
      ...(current?.closeUps ?? []).filter((earlier) =>
        placementCloseUps.every((latest) => latest.label !== earlier.label),
      ),
      ...placementCloseUps,
    ];
    setHistory((h) => ({
      ...h,
      [view]: [
        ...h[view],
        {
          image: result.image,
          items: [...(current?.items || []), piece],
          result,
          previewMode: result.previewMode,
          closeUps,
        },
      ],
    }));
    setReviewed(false);
    clearReview();
    setSavedLook(null);
    setZoom(1);
    setZoomFocus(null);
    setNotice("Overlay preview ready — no AI credit used. Review its placement before saving.");
    return true;
  }
  async function applyOverlay(prepared: OverlayPrepared, placements: OverlayPlacement[]) {
    if (!draft.item) return false;
    const attempt = begin("Applying free overlay");
    try {
      return await renderOverlayPreview(draft.item, prepared, placements, attempt);
    } catch (e) {
      if (valid(attempt.version)) setError((e as Error).message);
      return false;
    } finally {
      finish(attempt.version);
    }
  }
  async function comparisonRequest(label: string, path: string, body: unknown, timeout = 30000) {
    const { version, abort } = begin(label);
    try {
      const result = await jewelleryApi(path, body, abort.signal, timeout);
      return valid(version) ? result : null;
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
      return null;
    } finally {
      finish(version);
    }
  }
  function adoptVariant({ item, result }: { item: JewelleryItem; result: JewelleryResult }) {
    const piece: Piece = {
      itemId: item.id,
      name: item.name,
      type: item.garmentType,
      attributes: { ...item.attributes, ...(item.garmentType === "bangles" ? { count } : {}) },
      ...placement,
      resultId: result.resultId,
    };
    setHistory((h) => ({
      ...h,
      [view]: [
        ...h[view],
        {
          image: result.image,
          items: [...(current?.items || []), piece],
          result,
          previewMode: result.previewMode,
        },
      ],
    }));
    setReviewed(false);
    clearReview();
    setSavedLook(null);
    setNotice(
      item.name +
        " added from the comparison. Review this look before saving or adding another piece.",
    );
  }
  async function downloadComparison(result: JewelleryResult) {
    const { version, abort } = begin("Preparing variant download");
    try {
      await downloadJewellery(
        result.image,
        result.view,
        abort.signal,
        () => valid(version),
        result.previewMode,
      );
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  async function generate() {
    if (!type || !reviewed || !consent) return;
    const { version, abort } = begin("Trying jewellery");
    setConsent(false);
    const piece: Piece = {
      itemId: draft.item?.id || null,
      name: draft.name,
      type,
      attributes: attrs,
      ...placement,
    };
    try {
      const payload = {
        avatarId: avatar,
        view,
        sessionId: fittingSession.current,
        ...placement,
        ...(current ? { base: current.image, ...baseProof, baseReviewed: true } : {}),
        ...(draft.item
          ? { itemId: draft.item.id, ...(type === "bangles" ? { count } : {}) }
          : { image: draft.image, type, attributes: attrs, title: draft.name }),
        consent: true,
        consentScope: "view-and-item",
        consentProvider: "gemini",
        requestId: crypto.randomUUID(),
      };
      const result: JewelleryResult = await jewelleryApi(
        "/api/jewellery/tryon",
        payload,
        abort.signal,
        200000,
      );
      if (result.view !== view || !result.image?.startsWith("data:image/png;base64,"))
        throw new Error("The studio returned an unsupported jewellery preview.");
      if (valid(version)) {
        setHistory((h) => ({
          ...h,
          [view]: [
            ...h[view],
            {
              image: result.image,
              items: [...(current?.items || []), { ...piece, resultId: result.resultId }],
              result,
              previewMode: result.previewMode,
            },
          ],
        }));
        setReviewed(false);
        setStorage(false);
        setSavedLook(null);
        setZoom(1);
        setNotice(
          result.reused
            ? "Approved adaptation reused — no AI credit used."
            : "Jewellery preview ready. Check the face, skin tone, placement and product details before keeping it.",
        );
      }
    } catch (e) {
      if (valid(version))
        setError(
          ["AbortError", "TimeoutError"].includes((e as Error).name)
            ? "Request stopped or timed out. No automatic retry was made; the provider may still charge."
            : (e as Error).message,
        );
    } finally {
      window.dispatchEvent(new Event("forme-credits-changed"));
      finish(version);
    }
  }
  async function saveCatalogueProduct(garmentType: JewelleryType, signal: AbortSignal) {
    const { garment } = await jewelleryApi(
      "/api/garments",
      {
        category: "jewellery",
        name: draft.name,
        garmentType,
        attributes: attrs,
        image: draft.image,
        sourceUrl: draft.url,
        storageConsent: true,
        ...(draft.cutout?.png && {
          overlayPng: draft.cutout.png,
          overlayAnchor: overlayAnchors[garmentType],
        }),
      },
      signal,
    );
    return { ...garment, image: draft.image } as JewelleryItem;
  }
  async function saveProduct() {
    if (!type) return;
    const { version, abort } = begin("Saving product");
    try {
      const item = await saveCatalogueProduct(type, abort.signal);
      if (valid(version)) {
        applyDraft(savedDraft(item));
        setNotice(
          draft.cutout?.png
            ? "Product and cut-out saved to your catalogue. No AI credit used."
            : "Product saved to your catalogue. No AI credit used.",
        );
      }
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  async function previewAutomaticOverlay() {
    if (!type || (!draft.item?.hasOverlay && !draft.cutout?.png)) return;
    const attempt = begin(draft.item ? "Placing jewellery" : "Saving product and cut-out");
    let saved = false;
    try {
      const item = draft.item ?? (await saveCatalogueProduct(type, attempt.abort.signal));
      if (!valid(attempt.version)) return;
      if (!draft.item) {
        saved = true;
        // Keep the view and the selected wrist, finger or side for the preview.
        setDraft(savedDraft(item));
        setMatches([]);
        setPhotos([]);
        setBusy("Placing jewellery");
      }
      const prepared = await requestOverlayPlacement(item, attempt);
      if (!prepared || !valid(attempt.version)) return;
      if (await renderOverlayPreview(item, prepared, prepared.placements, attempt))
        preview.current?.scrollIntoView({ block: "center" });
    } catch (e) {
      if (valid(attempt.version))
        setError((saved ? "The product and cut-out were saved. " : "") + (e as Error).message);
    } finally {
      finish(attempt.version);
    }
  }
  async function keep() {
    if (!current || !reviewed || !storage) return;
    const { version, abort } = begin("Saving jewellery look");
    try {
      const result = await jewelleryApi(
        "/api/jewellery/looks",
        {
          avatarId: avatar,
          view,
          sessionId: fittingSession.current,
          image: current.image,
          name: lookName,
          itemsJson: current.items,
          reviewed: true,
          storageConsent: true,
          receipt: current.result?.receipt,
          resultId: current.result?.receipt ? undefined : current.result?.resultId,
          baseLookId: current.baseLookId,
        },
        abort.signal,
      );
      if (!valid(version)) return;
      setSavedLook({ id: result.id, image: current.image });
      setNotice(
        "Jewellery look saved to this avatar. It can be reopened without generating again.",
      );
      setStorage(false);
      for (const frame of frames) {
        if (
          frame.result?.kind !== "jewellery-overlay" &&
          frame.result?.receipt &&
          frame.items.at(-1)?.itemId &&
          !frame.saved
        ) {
          try {
            await jewelleryApi(
              "/api/jewellery/results/" + frame.result.resultId + "/approve",
              {
                image: frame.image,
                receipt: frame.result.receipt,
                reviewed: true,
                storageConsent: true,
              },
              abort.signal,
            );
            if (valid(version))
              setHistory((h) => ({
                ...h,
                [view]: h[view].map((f) => (f === frame ? { ...f, saved: true } : f)),
              }));
          } catch (e) {
            if (valid(version))
              setError(
                "The look is saved, but automatic adaptation reuse was not: " +
                  (e as Error).message,
              );
            break;
          }
        }
      }
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  async function download() {
    if (!reviewed || !current) return;
    const { version, abort } = begin("Preparing download");
    try {
      await downloadJewellery(
        current.image,
        view,
        abort.signal,
        () => valid(version),
        current.previewMode,
      );
      if (valid(version)) setNotice("Jewellery PNG downloaded with its preview label.");
    } catch (e) {
      if (valid(version)) setError((e as Error).message);
    } finally {
      finish(version);
    }
  }
  const canTry =
    available &&
    !busy &&
    !loading &&
    !!image &&
    !!roots[view] &&
    !!draft.image &&
    !!type &&
    typeConfirmed &&
    !!attrs.metal &&
    !!draft.name.trim() &&
    consent &&
    reviewed &&
    (!current || !!baseProof) &&
    (current?.items.length || 0) < 10;
  const canSaveProduct =
    manager && !busy && !loading && !!type && typeConfirmed && !!attrs.metal && !!draft.name.trim();
  const canOverlay =
    overlayEnabled &&
    !busy &&
    !loading &&
    !!image &&
    reviewed &&
    (!current || !!baseProof) &&
    (current?.items.length || 0) < 10;
  const sourceApproval = current?.result?.sourceApproval ?? current?.sourceApproval;
  return (
    <main className="billing-page jewellery-studio">
      <nav className="jewellery-navigation">
        {avatar && <TryOnTabs current="jewellery" avatarId={avatar} disabled={!!busy} />}
        <details>
          <summary>More options</summary>
          <div>
            <a href="/jewellery-catalogue">Jewellery catalogue</a>
            <a href={"/complete-look?avatar=" + encodeURIComponent(avatar)}>Complete look</a>
            <a href={"/avatar-views?avatar=" + encodeURIComponent(avatar)}>Saved views</a>
          </div>
        </details>
      </nav>
      <span className="eyebrow">YOUR JEWELLERY STUDIO</span>
      <h1>Try jewellery.</h1>
      <p>Choose a piece for your saved avatar. Keep the looks you love.</p>
      {enabled === null && <p role="status">Opening jewellery studio…</p>}
      {enabled === false && <p>Jewellery try-on is not enabled on this studio.</p>}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {enabled && role && (
        <>
          <ol className="fitting-guide" aria-label="Jewellery fitting steps">
            <li>
              <span>1</span> Choose a view
            </li>
            <li>
              <span>2</span> Add jewellery
            </li>
            <li>
              <span>3</span> Review & save
            </li>
          </ol>
          <label>
            Saved customer avatar
            <select
              aria-label="Saved customer avatar"
              value={avatar}
              disabled={loading || !!busy || loading}
              onChange={(e) => chooseAvatar(e.target.value)}
            >
              <option value="" disabled>
                Choose a saved avatar
              </option>
              {avatars.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          {!avatars.length && <p>Save a full-body customer avatar from Forme first.</p>}
          {selected && (
            <>
              <div className="outfit-tabs" role="group" aria-label="Jewellery view">
                {(["portrait", "hands", "full"] as View[]).map((v) => (
                  <button
                    key={v}
                    aria-pressed={view === v}
                    disabled={loading || !!busy || loading}
                    onClick={() => chooseView(v)}
                  >
                    {viewNames[v]} view
                  </button>
                ))}
              </div>
              <p className="jewellery-view-help">
                {view === "portrait"
                  ? "Portrait: earrings, nose pins and necklaces."
                  : view === "hands"
                    ? "Hands: rings, bangles, bracelets and watches."
                    : "Full body: long necklaces, waist belts and anklets."}
              </p>
              <div className="jewellery-layout">
                <section className="jewellery-preview" aria-label="Jewellery preview">
                  <div className="outfit-preview-title">
                    <strong>
                      {selected.name} · {viewNames[view]}
                    </strong>
                    <span>{current ? "Jewellery look" : "Approved saved view"}</span>
                  </div>
                  <div className="jewellery-image" ref={preview}>
                    {image ? (
                      <img
                        src={image}
                        alt={
                          current ? "Customer jewellery preview" : "Approved " + view + " reference"
                        }
                        style={{ width: zoom * 100 + "%", height: zoom * 100 + "%" }}
                      />
                    ) : (
                      <p>
                        {loading
                          ? "Opening saved view…"
                          : "No approved " +
                            viewNames[view].toLowerCase() +
                            " view yet. Prepare one to begin."}
                      </p>
                    )}
                  </div>
                  <p className="jewellery-ai-label">
                    {current ? previewLabel(current.previewMode) : "Approved saved view"}
                  </p>
                  {view === "hands" && (
                    <p className="small-footnote">
                      Tone-matched sample hands; these are not the customer’s own hands.
                    </p>
                  )}
                  {activeResultId && !!current?.closeUps?.length && (
                    <div
                      className="jewellery-overlay-views"
                      role="group"
                      aria-label="Look close-ups"
                    >
                      <button
                        className="button secondary"
                        onClick={() => {
                          setZoom(1);
                          setZoomFocus(null);
                          preview.current?.scrollTo(0, 0);
                        }}
                      >
                        Full look
                      </button>
                      {current.closeUps.map(({ label, x, y }) => (
                        <button
                          className="button secondary"
                          key={label}
                          onClick={() => {
                            setZoomFocus({ resultId: activeResultId, x, y });
                            setZoom(3);
                          }}
                        >
                          Zoom to {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <label>
                    Preview zoom
                    <input
                      type="range"
                      min="1"
                      max="3"
                      step="0.1"
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    />
                  </label>
                  <p className="small-footnote">
                    Pinch to zoom on touch screens, or use the zoom slider and scroll inside the
                    preview.
                  </p>
                  {image && roots[view] && view !== "hands" && (
                    <JewelleryNecklaceGuide
                      key={JSON.stringify([
                        avatar,
                        view,
                        rootRevision,
                        current?.result?.resultId,
                        current?.baseLookId,
                      ])}
                      avatarId={avatar}
                      view={view}
                      image={image}
                      referenceImage={roots[view]!}
                      lengthCm={attrs.lengthCm}
                      disabled={loading || !!busy}
                    />
                  )}
                  {image && (
                    <label className="consent">
                      <input
                        type="checkbox"
                        checked={reviewed}
                        disabled={loading || !!busy}
                        onChange={(e) => {
                          setReviewed(e.target.checked);
                          setStorage(false);
                        }}
                      />
                      <span>
                        I have checked the customer, complexion, proportions and jewellery placement
                        in this preview.
                      </span>
                    </label>
                  )}
                  {!!frames.length && (
                    <>
                      <h2>Pieces in this view</h2>
                      {sourceApproval && (
                        <p className="small-footnote">
                          Source avatar master version {sourceApproval.masterVersion}
                          {sourceApproval.approvalVersion != null &&
                            ` · approval ${sourceApproval.approvalVersion}`}
                        </p>
                      )}
                      {current?.baseLookId && (
                        <p className="small-footnote">
                          This saved look is a complete image. Undo applies to new additions made in
                          this session.
                        </p>
                      )}
                      <ol>
                        {current?.items.map((p, i) => (
                          <li key={i}>
                            {p.name} · {p.type.replaceAll("_", " ")}
                            {p.side ? " · " + p.side : ""}
                            {p.finger ? " · " + p.hand + " " + p.finger + " finger" : ""}
                          </li>
                        ))}
                      </ol>
                      <button
                        className="button secondary"
                        disabled={loading || !!busy || !!current?.baseLookId}
                        onClick={() => {
                          setHistory((h) => ({ ...h, [view]: h[view].slice(0, -1) }));
                          setReviewed(false);
                          clearReview();
                          setSavedLook(null);
                          setError("");
                          setNotice("Last item removed. No AI request was made.");
                        }}
                      >
                        <Undo2 size={16} /> Undo last jewellery item
                      </button>
                      <button
                        className="button back-button"
                        disabled={loading || !!busy}
                        onClick={() => {
                          setHistory((h) => ({ ...h, [view]: [] }));
                          setReviewed(false);
                          clearReview();
                          setSavedLook(null);
                          setNotice("Original saved view restored. No AI request was made.");
                        }}
                      >
                        Reset jewellery view
                      </button>
                    </>
                  )}
                </section>
                <div className="jewellery-controls">
                  {view !== "full" && (
                    <section>
                      <h2>
                        {roots[view]
                          ? "Saved " + viewNames[view].toLowerCase() + " reference"
                          : "Prepare " + viewNames[view].toLowerCase() + " view"}
                      </h2>
                      <p>
                        {roots[view]
                          ? "This approved view is reused for each piece. Prepare a replacement only when needed."
                          : view === "portrait"
                            ? "Create one reusable portrait before fitting earrings, nose pins and necklaces."
                            : "Prepare reusable hands in the selected template tone, at no AI cost."}
                      </p>
                      <button
                        className="button secondary"
                        disabled={loading || !!busy || loading}
                        onClick={() => setPreparing(!preparing)}
                      >
                        {preparing
                          ? "Close view preparation"
                          : roots[view]
                            ? "Manage " + viewNames[view].toLowerCase() + " view"
                            : view === "portrait"
                              ? "Create portrait — 1 AI request"
                              : "Prepare sample hands — free"}
                      </button>
                      {preparing && (
                        <AvatarViews
                          key={avatar + view}
                          embedded
                          avatarId={avatar}
                          initialKind={view}
                          onApproved={(kind, value) => {
                            setRootRevision((r) => r + 1);
                            setRoots((r) => ({ ...r, [kind]: value }));
                            setHistory((h) => ({ ...h, [kind]: [] }));
                            setPreparing(false);
                            setReviewed(false);
                            clearReview();
                            setNotice("Approved view ready. Select a jewellery item to begin.");
                          }}
                        />
                      )}
                    </section>
                  )}
                  <section>
                    <h2>
                      <Gem size={20} /> Choose jewellery
                    </h2>
                    <div
                      className="fitting-source jewellery-source"
                      role="group"
                      aria-label="Jewellery source"
                    >
                      {(
                        [
                          ["saved", "Saved jewellery"],
                          ["photo", "Upload photo"],
                          ["link", "Product link"],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          disabled={loading || !!busy}
                          aria-pressed={source === id}
                          onClick={() => {
                            setSource(id);
                            if (id === "saved" && source !== "saved") void browse(offset);
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div hidden={source !== "saved"}>
                      <form
                        className="catalogue-filters"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void browse();
                        }}
                      >
                        <label>
                          Search jewellery
                          <input
                            value={search}
                            maxLength={120}
                            disabled={loading || !!busy}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                        <label>
                          Filter jewellery type
                          <select
                            aria-label="Filter jewellery type"
                            value={filterType}
                            disabled={loading || !!busy}
                            onChange={(e) => setFilterType(e.target.value)}
                          >
                            <option value="all">All types</option>
                            {jewelleryChoices.map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Filter metal
                          <select
                            aria-label="Filter metal"
                            value={metal}
                            disabled={loading || !!busy}
                            onChange={(e) => setMetal(e.target.value)}
                          >
                            <option value="all">All metals</option>
                            {jewelleryMetals.map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button className="button secondary" disabled={loading || !!busy}>
                          Search saved jewellery
                        </button>
                      </form>
                      <div className="jewellery-products">
                        {items.map((i) => (
                          <button
                            className="garment-tile"
                            key={i.id}
                            disabled={loading || !!busy || loading}
                            aria-pressed={draft.item?.id === i.id}
                            onClick={() => void chooseItem(i)}
                          >
                            <img src={i.thumbnail} alt="" />
                            <strong>{i.name}</strong>
                            <small>
                              {jewelleryMetals.find(([id]) => id === i.attributes.metal)?.[1]}{" "}
                              {i.attributes.purity || ""}
                            </small>
                            {i.priceInr != null && (
                              <small>
                                {new Intl.NumberFormat("en-IN", {
                                  style: "currency",
                                  currency: "INR",
                                }).format(i.priceInr)}
                              </small>
                            )}
                          </button>
                        ))}
                      </div>
                      {!items.length && (
                        <p>
                          No saved jewellery matches. Choose Upload photo or Product link to add a
                          piece.
                        </p>
                      )}
                      <div className="customer-actions">
                        <button
                          className="button secondary"
                          disabled={loading || !!busy || offset === 0}
                          onClick={() => void browse(Math.max(0, offset - 12))}
                        >
                          Previous items
                        </button>
                        <button
                          className="button secondary"
                          disabled={loading || !!busy || offset + 12 >= total}
                          onClick={() => void browse(offset + 12)}
                        >
                          Next items
                        </button>
                      </div>
                    </div>
                    <div hidden={source !== "link"}>
                      <h3>Add a product link</h3>
                      <p>Paste the product page address, then choose the photo to try.</p>
                      <div className="link-row">
                        <input
                          aria-label="Jewellery product link"
                          type="url"
                          value={url}
                          disabled={loading || !!busy}
                          onChange={(e) => setUrl(e.target.value)}
                        />
                        <button
                          className="button secondary"
                          disabled={loading || !!busy || !url.trim()}
                          onClick={() => void readLink()}
                        >
                          <Search size={16} /> Find photos
                        </button>
                      </div>
                      {url.trim() && (
                        <button
                          className="button back-button"
                          disabled={loading || !!busy}
                          onClick={() => void readLink(true)}
                        >
                          Read website again
                        </button>
                      )}
                    </div>
                    <div hidden={source !== "photo"}>
                      <p>
                        {overlayEnabled && manager
                          ? "For a free overlay, upload one piece as a transparent PNG or a photo on a plain backdrop."
                          : "Choose a clear product photo or screenshot."}
                      </p>
                      <label>
                        Upload jewellery product photo
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={loading || !!busy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void upload(f);
                          }}
                        />
                      </label>
                    </div>
                    {!!matches.length && (
                      <div className="jewellery-products" aria-label="Saved jewellery matches">
                        {matches.map((i, n) => (
                          <button
                            key={i.id + ":" + n}
                            className="garment-tile"
                            disabled={loading || !!busy}
                            onClick={() => void chooseItem(i)}
                          >
                            <img src={i.thumbnail} alt="" />
                            <strong>Use saved {i.name}</strong>
                          </button>
                        ))}
                      </div>
                    )}
                    {!!photos.length && (
                      <div
                        className="product-images"
                        role="group"
                        aria-label="Jewellery product photos"
                      >
                        {photos.map((p, i) => (
                          <button
                            key={i}
                            className="garment-tile"
                            disabled={loading || !!busy}
                            aria-pressed={draft.image === p.image}
                            onClick={() => {
                              applyDraft({ ...draft, image: p.image, item: null });
                              setTypeConfirmed(false);
                            }}
                          >
                            <img src={p.image} alt={"Jewellery product photo " + (i + 1)} />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  {draft.image && (
                    <section>
                      <h2>Fit this piece</h2>
                      <div className="outfit-tabs" role="group" aria-label="Jewellery fitting mode">
                        <button
                          aria-pressed={mode === "ai"}
                          disabled={loading || !!busy}
                          onClick={() => {
                            setMode("ai");
                            setConsent(false);
                          }}
                        >
                          AI adaptation
                        </button>
                        <button
                          aria-pressed={mode === "overlay"}
                          disabled={loading || !!busy || !overlayEnabled}
                          onClick={() => {
                            setMode("overlay");
                            setReplace(false);
                            setConsent(false);
                          }}
                        >
                          Overlay · free
                        </button>
                      </div>
                      <img
                        className="jewellery-product-reference"
                        src={draft.image}
                        alt="Selected jewellery product"
                      />
                      <label>
                        Jewellery item name
                        <input
                          maxLength={100}
                          value={draft.name}
                          disabled={loading || !!busy || !!draft.item}
                          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        />
                      </label>
                      <label>
                        Jewellery type
                        <select
                          aria-label="Jewellery type"
                          value={type || ""}
                          disabled={loading || !!busy || !!draft.item}
                          onChange={(e) => {
                            const value = e.target.value as JewelleryType;
                            applyDraft({
                              ...draft,
                              type: value,
                              attributes: { ...draft.attributes, pair: jewelleryTypes[value].pair },
                            });
                            setTypeConfirmed(false);
                          }}
                        >
                          <option value="" disabled>
                            Choose the piece to try
                          </option>
                          {jewelleryChoices.map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {(type === "ring" || type === "bangles") && (
                        <JewellerySizeHelp
                          key={avatar}
                          avatarId={avatar}
                          type={type}
                          attributes={attrs}
                          hand={hand}
                          finger={finger}
                          wrist={wrist}
                          disabled={loading || !!busy}
                        />
                      )}
                      {!draft.item && (
                        <>
                          <label>
                            Metal
                            <select
                              aria-label="Metal"
                              value={draft.attributes.metal}
                              disabled={loading || !!busy}
                              onChange={(e) => attribute("metal", e.target.value)}
                            >
                              <option value="">Choose metal</option>
                              {jewelleryMetals.map(([id, label]) => (
                                <option key={id} value={id}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="consent">
                            <input
                              type="checkbox"
                              checked={typeConfirmed}
                              disabled={loading || !!busy || !type}
                              onChange={(e) => {
                                setTypeConfirmed(e.target.checked);
                                setConsent(false);
                              }}
                            />
                            <span>I confirm the jewellery type and selected product photo.</span>
                          </label>
                          {type && jewelleryTypes[type].pair && (
                            <label className="consent">
                              <input
                                type="checkbox"
                                checked={draft.attributes.pair ?? true}
                                disabled={loading || !!busy}
                                onChange={(e) => {
                                  attribute("pair", e.target.checked);
                                  setSide(e.target.checked ? "both" : "left");
                                }}
                              />
                              <span>Use a matched pair</span>
                            </label>
                          )}
                          <details>
                            <summary>Optional product dimensions</summary>
                            {(
                              [
                                ["lengthCm", "Chain / necklace length (cm)", 20, 120],
                                ["dropMm", "Earring drop (mm)", 2, 150],
                                ["pendantMm", "Pendant height (mm)", 5, 150],
                                ["ringSizeIn", "Indian ring size", 1, 30],
                              ] as const
                            ).map(([key, label, min, max]) => (
                              <label key={key}>
                                {label}
                                <input
                                  type="number"
                                  min={min}
                                  max={max}
                                  step={key === "ringSizeIn" ? 1 : "any"}
                                  value={draft.attributes[key] ?? ""}
                                  disabled={loading || !!busy}
                                  onChange={(e) => attribute(key, e.target.value)}
                                />
                              </label>
                            ))}
                            <label>
                              Purity
                              <input
                                maxLength={10}
                                value={draft.attributes.purity || ""}
                                disabled={loading || !!busy}
                                onChange={(e) => attribute("purity", e.target.value)}
                              />
                            </label>
                            <label>
                              Stones
                              <input
                                maxLength={80}
                                value={draft.attributes.stones || ""}
                                disabled={loading || !!busy}
                                onChange={(e) => attribute("stones", e.target.value)}
                              />
                            </label>
                            <label>
                              Indian bangle size
                              <select
                                aria-label="Indian bangle size"
                                value={draft.attributes.bangleSize || ""}
                                disabled={loading || !!busy}
                                onChange={(e) => attribute("bangleSize", e.target.value)}
                              >
                                <option value="">Not specified</option>
                                {bangleSizes.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </label>
                          </details>
                          {manager && (
                            <button
                              className="button secondary"
                              disabled={!canSaveProduct}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    draft.cutout?.png
                                      ? "Save this product photo and cut-out to your store catalogue? No AI credit is used."
                                      : "Save this product photo and its details to your store catalogue? No AI credit is used.",
                                  )
                                )
                                  void saveProduct();
                              }}
                            >
                              Save product to catalogue
                            </button>
                          )}
                        </>
                      )}
                      {definition?.needsFinger ? (
                        <>
                          <label>
                            Hand
                            <select
                              aria-label="Hand"
                              value={hand}
                              disabled={loading || !!busy}
                              onChange={(e) => {
                                setHand(e.target.value);
                                setConsent(false);
                              }}
                            >
                              <option value="left">Left</option>
                              <option value="right">Right</option>
                            </select>
                          </label>
                          <label>
                            Finger
                            <select
                              aria-label="Finger"
                              value={finger}
                              disabled={loading || !!busy}
                              onChange={(e) => {
                                setFinger(e.target.value);
                                setConsent(false);
                              }}
                            >
                              {["thumb", "index", "middle", "ring", "little"].map((f) => (
                                <option key={f}>{f}</option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : definition?.needsWrist ? (
                        <>
                          <label>
                            Wrist
                            <select
                              aria-label="Wrist"
                              value={wrist}
                              disabled={loading || !!busy}
                              onChange={(e) => {
                                setWrist(e.target.value);
                                setConsent(false);
                              }}
                            >
                              {definition.sides.map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                          {type === "bangles" && (
                            <label>
                              Bangle count per wrist
                              <input
                                type="number"
                                min="1"
                                max="24"
                                step="1"
                                value={count}
                                disabled={loading || !!busy}
                                onChange={(e) => {
                                  setCount(Number(e.target.value));
                                  setConsent(false);
                                }}
                              />
                            </label>
                          )}
                        </>
                      ) : (
                        !!definition?.sides.length && (
                          <label>
                            Side
                            <select
                              aria-label="Side"
                              value={side}
                              disabled={
                                loading || !!busy || (definition.pair && (attrs.pair ?? true))
                              }
                              onChange={(e) => {
                                setSide(e.target.value);
                                setConsent(false);
                              }}
                            >
                              {(definition.pair && (attrs.pair ?? true)
                                ? ["both"]
                                : ["left", "right"]
                              ).map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          </label>
                        )
                      )}
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={replace}
                          disabled={loading || !!busy || mode === "overlay"}
                          onChange={(e) => {
                            setReplace(e.target.checked);
                            setConsent(false);
                          }}
                        />
                        <span>Replace existing jewellery in this region only.</span>
                      </label>
                      <p className="small-footnote">
                        Left and right refer to the customer’s own sides.
                      </p>
                      <p>{scaleNote(attrs)}</p>
                      <p className="small-footnote">
                        Dimensions guide approximate appearance and do not verify physical fit.
                      </p>
                      {mode === "ai" ? (
                        <>
                          {!available && (
                            <p>
                              New AI generation is unavailable for this body library. Saved looks
                              can still be opened.
                            </p>
                          )}
                          {current && !baseProof && (
                            <p role="alert">
                              Keep or download this preview. Its result cannot be verified as the
                              next base; no automatic retry will be made.
                            </p>
                          )}
                          <label className="consent">
                            <input
                              type="checkbox"
                              checked={consent}
                              disabled={loading || !!busy || !available || !image}
                              onChange={(e) => setConsent(e.target.checked)}
                            />
                            <span>
                              The customer agrees to send this avatar view and jewellery product
                              photo to Google Gemini. A new preview uses 1 AI credit; an approved
                              exact match is reused free.
                            </span>
                          </label>
                          <button
                            className="button primary full-width"
                            disabled={!canTry}
                            onClick={() => void generate()}
                          >
                            <Sparkles size={17} /> Try jewellery — up to 1 AI credit
                          </button>
                          {draft.item && (
                            <JewelleryCompare
                              key={JSON.stringify([
                                avatar,
                                view,
                                draft.item.id,
                                frames.length,
                                current?.result?.resultId,
                                current?.baseLookId,
                                rootRevision,
                                placement,
                                count,
                              ])}
                              item={draft.item}
                              payload={{
                                avatarId: avatar,
                                view,
                                sessionId: fittingSession.current,
                                ...placement,
                                ...(type === "bangles" ? { count } : {}),
                                ...(current
                                  ? { base: current.image, ...baseProof, baseReviewed: true }
                                  : {}),
                              }}
                              disabled={
                                loading ||
                                !!busy ||
                                !image ||
                                !reviewed ||
                                (!!current && !baseProof) ||
                                (current?.items.length || 0) >= 10
                              }
                              request={comparisonRequest}
                              onAdopt={adoptVariant}
                              onDownload={(result) => void downloadComparison(result)}
                            />
                          )}
                        </>
                      ) : (
                        <>
                          {!draft.item && draft.cutout ? (
                            draft.cutout.png ? (
                              <>
                                <img
                                  className="jewellery-product-reference cutout-checker"
                                  src={draft.cutout.png}
                                  alt="Automatic jewellery cut-out"
                                />
                                <p>
                                  Check the cut-out and review the avatar view before placing it.
                                </p>
                                <button
                                  className="button primary full-width"
                                  disabled={!canSaveProduct || !canOverlay}
                                  onClick={() => void previewAutomaticOverlay()}
                                >
                                  Save to catalogue and preview — free
                                </button>
                              </>
                            ) : (
                              <p role="status">{draft.cutout.error}</p>
                            )
                          ) : !draft.item?.hasOverlay ? (
                            <p>
                              Add a transparent cut-out to this saved piece in the{" "}
                              <a href="/jewellery-catalogue">jewellery catalogue</a> first. Owners
                              and managers can upload it; staff can use saved cut-outs.
                            </p>
                          ) : (
                            <>
                              <p>
                                Review the approved view before loading placement. No AI consent or
                                credit is required for an overlay.
                              </p>
                              <button
                                className="button primary full-width"
                                disabled={!canOverlay}
                                onClick={() => void previewAutomaticOverlay()}
                              >
                                Preview on avatar — free
                              </button>
                              <JewelleryOverlay
                                anchor={overlayAnchors[draft.item.garmentType]}
                                key={JSON.stringify([
                                  avatar,
                                  view,
                                  draft.item.id,
                                  frames.length,
                                  current?.result?.resultId,
                                  current?.baseLookId,
                                  rootRevision,
                                  placement,
                                  count,
                                ])}
                                disabled={!canOverlay}
                                onPrepare={prepareOverlay}
                                onApply={applyOverlay}
                              />
                            </>
                          )}
                        </>
                      )}
                    </section>
                  )}
                  {current && (
                    <section>
                      <h2>Keep this jewellery look</h2>
                      <label>
                        Jewellery look name
                        <input
                          maxLength={60}
                          value={lookName}
                          disabled={loading || !!busy}
                          onChange={(e) => setLookName(e.target.value)}
                        />
                      </label>
                      <label className="consent">
                        <input
                          type="checkbox"
                          checked={storage}
                          disabled={loading || !!busy || !reviewed}
                          onChange={(e) => setStorage(e.target.checked)}
                        />
                        <span>
                          The customer agrees to save this jewellery look and its reviewed
                          adaptations to the store account.
                        </span>
                      </label>
                      <button
                        className="button primary full-width"
                        disabled={loading || !!busy || !reviewed || !storage || !lookName.trim()}
                        onClick={() => void keep()}
                      >
                        Save jewellery look
                      </button>
                      <button
                        className="button secondary full-width"
                        disabled={loading || !!busy || !reviewed}
                        onClick={() => void download()}
                      >
                        <Download size={16} /> Download jewellery PNG
                      </button>
                      <p className="small-footnote">
                        If saving fails, keep the reviewed PNG. Do not generate another image just
                        to save it.
                      </p>
                      {savedLook?.image === current.image && reviewed && (
                        <ShareLook
                          key={savedLook.id}
                          lookId={savedLook.id}
                          disabled={loading || !!busy}
                          kind="jewellery"
                        />
                      )}
                    </section>
                  )}
                </div>
              </div>
              {busy && (
                <div className="jewellery-working" role="status">
                  {busy}…
                  <button
                    className="button secondary"
                    onClick={() => {
                      epoch.current++;
                      controller.current?.abort();
                      controller.current = null;
                      setBusy("");
                      setConsent(false);
                      setError(
                        mode === "overlay"
                          ? "Overlay request stopped. No AI credit used."
                          : "Request stopped. No automatic retry was sent; a provider charge may still apply.",
                      );
                    }}
                  >
                    Cancel request
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
