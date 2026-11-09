// Serialized into the nonce-protected shopper shell. Keep all private bytes and
// capabilities in this closure; there is no storage, analytics or service worker.
export function shopperWorkflowClient(recommendProfile) {
  const $ = (id) => document.getElementById(id),
    status = $("message");
  let session = null,
    epoch = 0,
    ending = false,
    busy = false,
    checking = false,
    timer = null,
    poller = null,
    controller = null,
    verification = null,
    authorization = null,
    avatar = null,
    outfit = null,
    approval = null,
    approved = false,
    products = [],
    selected = "",
    phase = "consent",
    selectionTouched = false;
  const photos = { face: null, body: null },
    photoVersion = { face: 0, body: 0 },
    urls = new Set();
  const message = (text) => {
    status.textContent = text;
  };
  const url = (blob) => {
    const value = URL.createObjectURL(blob);
    urls.add(value);
    return value;
  };
  function removeUrl(value) {
    if (value) {
      URL.revokeObjectURL(value);
      urls.delete(value);
    }
  }
  function removeImage(id) {
    const image = $(id);
    removeUrl(image.dataset.blob);
    image.removeAttribute("src");
    delete image.dataset.blob;
  }
  function showImage(id, blob) {
    removeImage(id);
    const value = url(blob);
    $(id).src = value;
    $(id).dataset.blob = value;
  }
  function clearAuthorization() {
    authorization = null;
    $("adult").checked = false;
    $("own").checked = false;
    $("purpose").checked = false;
    $("verification").replaceChildren();
  }
  function clearPhotos() {
    for (const kind of ["face", "body"]) {
      photos[kind] = null;
      photoVersion[kind]++;
      removeImage(kind + "-preview");
      $(kind + "-name").textContent = "No photo selected.";
    }
    for (const input of $("photo-inputs").querySelectorAll("input")) input.value = "";
  }
  function clearPrivate() {
    controller?.abort();
    controller = null;
    try {
      verification?.reset?.();
    } catch {}
    clearAuthorization();
    clearPhotos();
    avatar = null;
    outfit = null;
    approval = null;
    approved = false;
    removeImage("avatar-result");
    removeImage("outfit-result");
    for (const value of urls) URL.revokeObjectURL(value);
    urls.clear();
    $("avatar-review-check").checked = false;
    $("outfit-review-check").checked = false;
  }
  function clear(text) {
    epoch++;
    clearPrivate();
    session = null;
    clearInterval(timer);
    clearInterval(poller);
    $("flow").hidden = true;
    $("end").hidden = true;
    $("expiry").textContent = "";
    $("attempts").textContent = "";
    message(text);
  }
  async function finish(text = "Shopper session ended. Open a product button to start again.") {
    if (ending) return;
    ending = true;
    const csrf = session?.csrf;
    clear(text);
    try {
      if (csrf)
        await fetch("/shopper-api/session", {
          method: "DELETE",
          credentials: "same-origin",
          keepalive: true,
          headers: { "X-Shopper-CSRF": csrf },
        });
    } catch {
    } finally {
      ending = false;
    }
  }
  function tick() {
    if (!session) return;
    if (Date.now() >= session.expiresAt) {
      void finish("This shopper session expired. Open the product button again.");
      return;
    }
    $("expiry").textContent =
      "Session time left: " +
      Math.ceil((session.expiresAt - Date.now()) / 60000) +
      " minutes. This time does not extend.";
    if (authorization && Date.now() >= authorization.expiresAt) {
      clearAuthorization();
      phase = approved ? "tryon-consent" : "consent";
      render();
      message("Verification expired. Confirm consent and verify again before sending photos.");
    }
  }
  async function api(path, { method = "GET", body, headers = {}, signal } = {}) {
    const response = await fetch("/shopper-api/" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET" && session ? { "X-Shopper-CSRF": session.csrf } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(
        "The studio returned no readable result. A provider charge may still apply; no automatic retry was sent.",
      );
    }
    if (!response.ok) {
      const error = new Error(
        data.error || "This action could not complete. No automatic retry was sent.",
      );
      error.status = response.status;
      error.code = data.code;
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    return data;
  }
  function update(data) {
    session = data;
    $("name").textContent = data.brand.displayName;
    $("brand").style.borderTopColor = data.brand.primaryColor;
    $("product").textContent = data.product.name;
    const link = $("return");
    link.href = data.product.url;
    link.hidden = false;
    $("end").hidden = false;
    const logo = $("logo");
    if (data.brand.logo) {
      logo.src = data.brand.logo;
      logo.alt = data.brand.displayName + " logo";
      logo.hidden = false;
    } else {
      logo.hidden = true;
      logo.removeAttribute("src");
    }
    $("attempts").textContent =
      data.attemptsRemaining +
      " image attempts remaining. The store pays 1 AI credit per successful image. Failed or timed-out attempts can still cost the provider.";
    if (!data.shopperGenerationAvailable) {
      epoch++;
      clearPrivate();
      $("flow").hidden = true;
      message(
        "Customer photo generation is unavailable. The store must finish its safety and consent setup. No new photos have been sent.",
      );
      return;
    }
    $("flow").hidden = false;
    const d = data.workflow.disclosure;
    $("provider").textContent = data.workflow.providerLabel;
    $("processing").textContent = d.processingText;
    $("privacy-contact").textContent = d.privacyContact;
    $("privacy").href = d.privacyUrl;
    $("terms").href = d.providerTermsUrl;
    $("purpose-text").textContent = approved ? d.tryonText : d.avatarText;
    $("revision").textContent = "Consent version " + d.revision + ".";
    if (data.avatarApproved && avatar) approved = true;
    if (data.avatarGenerated && !avatar) {
      phase = "lost";
      message(
        "This avatar was generated, but its image is no longer in this tab. Photos and results are not restored after a reload. Return to the product and start a new session; no generation was retried.",
      );
    } else if (data.processing && !busy) {
      phase = "lost";
      message(
        "An image request is already in progress for this session. This tab cannot recover its result. End this session before starting over; no generation was retried.",
      );
    }
    render();
    tick();
  }
  async function read() {
    if (!session || checking || ending) return;
    tick();
    if (!session) return;
    checking = true;
    const current = epoch;
    try {
      const data = await api("session");
      if (current === epoch && session) update(data);
    } catch (e) {
      if (current === epoch && session) clear(e.message);
    } finally {
      checking = false;
    }
  }
  function handle(e) {
    if (!session) return;
    if (
      e.status === 401 ||
      e.status === 410 ||
      ["shopper_session_invalid", "shopper_session_changed"].includes(e.code)
    ) {
      clear(e.message);
      return;
    }
    const retry = e.retryAfter ? " Wait " + e.retryAfter + " seconds before trying again." : "";
    message(e.message + retry);
  }
  function render() {
    if (!session?.shopperGenerationAvailable) return;
    $("flow").insertBefore($("consent"), approved ? $("products") : $("photos"));
    const consent = phase === "consent" || phase === "tryon-consent",
      showPhotos =
        (phase === "photos" || (phase === "consent" && (photos.face || photos.body))) && !avatar;
    $("consent").hidden = !consent;
    $("photos").hidden = !showPhotos;
    $("body-choice").hidden = !showPhotos;
    $("generate-avatar").hidden = phase !== "photos";
    $("avatar-review").hidden = !avatar;
    $("avatar-approve").hidden = approved;
    $("avatar-review-label").hidden = approved;
    $("avatar-download").disabled = !approved || busy;
    $("avatar-state").textContent = approved
      ? "Reviewed avatar"
      : "Generated avatar · review required";
    $("avatar-review").dataset.approved = String(approved);
    $("products").hidden = !approved;
    $("generate-tryon").hidden = phase !== "tryon-ready";
    $("new-tryon").hidden =
      phase !== "outfit" || !session.tryonsRemaining || !session.attemptsRemaining;
    $("outfit-review").hidden = !outfit;
    $("lost").hidden = phase !== "lost";
    $("verify").textContent = approved ? "Verify this try-on" : "Verify and continue to photos";
    $("purpose-text").textContent = approved
      ? session.workflow.disclosure.tryonText
      : session.workflow.disclosure.avatarText;
    $("consent-title").textContent = approved
      ? "Consent for this product preview"
      : "Before using your photos";
    $("verify").disabled =
      busy ||
      !$("adult").checked ||
      !$("own").checked ||
      !$("purpose").checked ||
      !session.attemptsRemaining ||
      (approved && !session.tryonsRemaining);
    $("generate-avatar").disabled =
      busy || !authorization || !photos.face || !photos.body || !validBody();
    $("generate-tryon").disabled = busy || !authorization || !approved || !avatar;
    $("avatar-approve").disabled = busy || !$("avatar-review-check").checked;
    $("outfit-download").disabled = busy || !$("outfit-review-check").checked;
    for (const node of document.querySelectorAll("[data-lock]"))
      node.disabled = busy || phase === "lost";
    for (const kind of ["face", "body"])
      for (const source of ["file", "camera"])
        $(kind + "-" + source + "-button").disabled = busy || !authorization;
    $("flow").setAttribute("aria-busy", String(busy));
  }
  function validBody() {
    const profile = session?.workflow.profiles.find((p) => p.id === $("profile").value);
    return (
      profile &&
      recommendProfile(Number($("height").value), Number($("weight").value), profile.body)
    );
  }
  function bodyChoice(suggest = false) {
    if (!session) return;
    const body = $("body-type").value,
      previous = $("profile").value;
    const available = session.workflow.profiles.filter((p) => p.body === body),
      suggested = recommendProfile(Number($("height").value), Number($("weight").value), body);
    $("profile").replaceChildren(
      ...available.map((p) => new Option(p.name + " — " + p.description, p.id)),
    );
    $("profile").value =
      suggest && !selectionTouched && suggested
        ? suggested
        : available.some((p) => p.id === previous)
          ? previous
          : available[0]?.id;
    $("suggestion").textContent = suggested
      ? "Suggested reference: " +
        (available.find((p) => p.id === suggested)?.name || "") +
        ". Height and weight are only an approximation; choose the frame that looks closest."
      : "Enter height 140–210 cm (female up to 200 cm) and weight 35–200 kg.";
    template();
    render();
  }
  function template() {
    if (session?.shopperGenerationAvailable)
      $("template").src =
        "/shopper-api/template?profile=" +
        encodeURIComponent($("profile").value) +
        "&tone=" +
        encodeURIComponent($("tone").value);
  }
  function makePhotoInputs() {
    if ($("photo-inputs").childElementCount) return;
    for (const kind of ["face", "body"])
      for (const source of ["file", "camera"]) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        input.id = kind + "-" + source;
        input.hidden = true;
        if (source === "camera")
          input.setAttribute("capture", kind === "face" ? "user" : "environment");
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          input.value = "";
          if (file) void photo(kind, file);
        });
        $("photo-inputs").append(input);
      }
  }
  async function photo(kind, file) {
    const version = ++photoVersion[kind],
      current = epoch;
    let bitmap;
    try {
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        !file.size ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error("Choose a JPEG, PNG or WebP photo under 5 MB.");
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (bitmap.width < 128 || bitmap.height < 128 || bitmap.width * bitmap.height > 12000000)
        throw new Error("Choose a photo at least 128 × 128 pixels and no more than 12 megapixels.");
      const scale = Math.min(1, 1024 / bitmap.width, 1536 / bitmap.height),
        canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error("This photo could not be prepared. Choose another file.");
      if (current !== epoch || version !== photoVersion[kind] || !session) return;
      photos[kind] = blob;
      showImage(kind + "-preview", blob);
      $(kind + "-name").textContent = "Photo ready. Preview stays in this tab until you generate.";
      message(
        "Your " +
          (kind === "face" ? "face" : "full-body") +
          " photo is ready. No photo has been sent.",
      );
      render();
    } catch (e) {
      if (current === epoch && session)
        message(e.message || "This photo could not be read. Choose another file.");
    } finally {
      bitmap?.close();
    }
  }
  const dataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("This image could not be read."));
      reader.readAsDataURL(blob);
    });
  function imageBlob(value) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value || "");
    if (!match) throw new Error("No usable image was returned. No automatic retry was sent.");
    const raw = atob(match[1]),
      bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  }
  async function loadVerification() {
    if (verification) return verification;
    if (!window.FormeShopperVerification) {
      const script = document.createElement("script");
      script.src = "/shopper-api/verification.js";
      script.nonce = $("workflow-script").nonce;
      const loaded = new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = () =>
          reject(new Error("Verification could not load. No photos have been sent."));
      });
      document.head.append(script);
      await loaded;
    }
    const adapter = window.FormeShopperVerification;
    if (
      adapter?.id !== session.workflow.verificationProvider ||
      typeof adapter.challenge !== "function"
    )
      throw new Error("Verification is unavailable. No photos have been sent.");
    verification = adapter;
    return adapter;
  }
  async function cancellable(work, signal) {
    signal.throwIfAborted();
    let stopped;
    const cancel = new Promise((_, reject) => {
      stopped = () => reject(signal.reason);
      signal.addEventListener("abort", stopped, { once: true });
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return work();
        }),
        cancel,
      ]);
    } finally {
      signal.removeEventListener("abort", stopped);
    }
  }
  async function verify() {
    if (busy || !session) return;
    await read();
    if (busy || !session?.shopperGenerationAvailable) return;
    const current = epoch,
      action = approved ? "tryon" : "avatar";
    busy = true;
    render();
    controller = new AbortController();
    const active = controller,
      deadline = setTimeout(
        () => active.abort(new Error("Verification timed out. No photos have been sent.")),
        120000,
      );
    try {
      const adapter = await cancellable(loadVerification, active.signal);
      if (current !== epoch || !session) return;
      const consent = await api("consent", {
        method: "POST",
        body: {
          action,
          provider: session.provider,
          revision: session.consentRevision,
          adult: $("adult").checked,
          ownPhotos: $("own").checked,
          accepted: $("purpose").checked,
        },
        signal: controller.signal,
      });
      const token = await cancellable(
        () =>
          adapter.challenge({
            action,
            container: $("verification"),
            nonce: $("workflow-script").nonce,
            signal: active.signal,
          }),
        active.signal,
      );
      if (current !== epoch || !session) return;
      const proof = await api("challenge", {
        method: "POST",
        body: { action, consent: consent.consent, token },
        signal: controller.signal,
      });
      if (current !== epoch || !session) return;
      authorization = {
        consent: consent.consent,
        proof: proof.proof,
        expiresAt: Math.min(consent.expiresAt, proof.expiresAt),
      };
      phase = approved ? "tryon-ready" : "photos";
      if (!approved) makePhotoInputs();
      message(
        approved
          ? "Verified. Generate the selected product preview when ready."
          : "Verified. Choose your own photos and check the body reference. Photos are sent only when you select Generate my avatar.",
      );
    } catch (e) {
      if (current === epoch) handle(e);
    } finally {
      clearTimeout(deadline);
      if (current === epoch) {
        busy = false;
        controller = null;
        render();
      }
    }
  }
  async function generate(action) {
    if (busy || !authorization || !session) return;
    await read();
    if (busy || !session || !authorization) return;
    tick();
    if (!authorization) return;
    const current = epoch,
      proof = authorization;
    authorization = null;
    busy = true;
    render();
    controller = new AbortController();
    const signal = controller.signal;
    if (action === "tryon") {
      outfit = null;
      removeImage("outfit-result");
      $("outfit-review-check").checked = false;
    }
    message(
      action === "avatar"
        ? "Generating your avatar. Your photos are sent once. Please keep this page open."
        : "Creating this product preview. This is a separate generation paid for by the store.",
    );
    try {
      const requestId = crypto.randomUUID(),
        body =
          action === "avatar"
            ? {
                requestId,
                face: await dataUrl(photos.face),
                body: await dataUrl(photos.body),
                profileId: $("profile").value,
                templateTone: $("tone").value,
                measurements: {
                  heightCm: Number($("height").value),
                  weightKg: Number($("weight").value),
                },
              }
            : { requestId, avatar: await dataUrl(avatar) };
      if (current !== epoch || signal.aborted) return;
      const output = await api(action, {
        method: "POST",
        body,
        headers: { "X-Shopper-Consent": proof.consent, "X-Shopper-Proof": proof.proof },
        signal,
      });
      if (current !== epoch || !session) return;
      const blob = imageBlob(output.image);
      clearAuthorization();
      if (action === "avatar") {
        avatar = blob;
        approval = output.approval;
        approved = false;
        clearPhotos();
        showImage("avatar-result", blob);
        phase = "avatar-review";
        message(
          "Your avatar is ready for review. Check the face, complexion, neck and proportions before approving it.",
        );
      } else {
        outfit = blob;
        showImage("outfit-result", blob);
        phase = "outfit";
        message(
          "AI clothing preview ready. Check it before downloading. Fit, colour and garment details may differ.",
        );
      }
      update(output.session);
      $("avatar-review-check").checked = false;
      $("outfit-review-check").checked = false;
    } catch (e) {
      if (current === epoch && session) {
        clearAuthorization();
        phase = approved ? "tryon-consent" : "consent";
        handle(e);
        await read();
      }
    } finally {
      if (current === epoch) {
        busy = false;
        controller = null;
        render();
      }
    }
  }
  async function approve() {
    if (busy || !avatar || !approval || !$("avatar-review-check").checked) return;
    await read();
    if (busy || !session || !avatar || !approval) return;
    const current = epoch;
    busy = true;
    render();
    try {
      await api("avatar/approve", { method: "POST", body: { approval, approved: true } });
      if (current !== epoch || !session) return;
      approved = true;
      approval = null;
      clearAuthorization();
      phase = "tryon-consent";
      message("Avatar approved. Give separate consent and verify before trying this product.");
      await read();
    } catch (e) {
      if (current === epoch) {
        handle(e);
        await read();
        if (approved) {
          approval = null;
          phase = "tryon-consent";
        }
      }
    } finally {
      if (current === epoch) {
        busy = false;
        render();
      }
    }
  }
  async function productChoices() {
    const data = await api("products");
    products = data.products;
    const select = $("product-choice");
    select.replaceChildren(
      ...products.map((p) => new Option(p.name + " (" + p.garmentType + ")", p.selection)),
    );
    selected = products.find((p) => p.selected)?.selection || "";
    select.value = selected;
    if (selected)
      $("garment").src = "/shopper-api/product-image?selection=" + encodeURIComponent(selected);
  }
  async function selectProduct() {
    if (busy || !session) return;
    const choice = $("product-choice").value;
    if (choice === selected) return;
    const current = epoch;
    busy = true;
    render();
    try {
      const data = await api("product", { method: "POST", body: { selection: choice } });
      if (current !== epoch || !session) return;
      clearAuthorization();
      outfit = null;
      removeImage("outfit-result");
      $("outfit-review-check").checked = false;
      phase = approved ? "tryon-consent" : "consent";
      update(data);
      await productChoices();
      message(
        "Product changed. Your approved avatar is reused; give fresh consent for this product.",
      );
    } catch (e) {
      if (current === epoch) {
        $("product-choice").value = selected;
        handle(e);
      }
    } finally {
      if (current === epoch) {
        busy = false;
        render();
      }
    }
  }
  async function download(kind) {
    const blob =
      kind === "avatar" ? approved && avatar : $("outfit-review-check").checked && outfit;
    if (!blob || busy || !session) return;
    await read();
    if (
      !session?.shopperGenerationAvailable ||
      !(kind === "avatar" ? approved && avatar : $("outfit-review-check").checked && outfit)
    )
      return;
    const current = epoch;
    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas"),
        footer = session.brand.exportFooter,
        strip = Math.max(80, Math.ceil(bitmap.width * (footer ? 0.16 : 0.1)));
      canvas.width = bitmap.width;
      canvas.height = bitmap.height + strip;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, bitmap.height, canvas.width, strip);
      ctx.fillStyle = "#215b4a";
      ctx.textAlign = "center";
      ctx.font = "bold " + Math.max(10, Math.floor(bitmap.width / 28)) + "px sans-serif";
      ctx.fillText(
        "AI preview — fit and details may differ",
        canvas.width / 2,
        bitmap.height + strip * (footer ? 0.45 : 0.6),
        canvas.width - 16,
      );
      if (footer) {
        ctx.font = Math.max(10, Math.floor(bitmap.width / 32)) + "px sans-serif";
        ctx.fillText(
          session.brand.displayName,
          canvas.width / 2,
          bitmap.height + strip * 0.78,
          canvas.width - 16,
        );
      }
      const output = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      canvas.width = canvas.height = 0;
      if (!output || current !== epoch || !session) return;
      const link = document.createElement("a"),
        href = url(output);
      link.href = href;
      link.download = "forme-" + kind + "-preview.png";
      link.click();
      setTimeout(() => removeUrl(href), 10000);
      message("Preview downloaded. This copy stays on your device after the session ends.");
    } catch {
      if (current === epoch && session)
        message("The preview could not be downloaded. Your image is still available in this tab.");
    } finally {
      bitmap?.close();
    }
  }
  for (const id of ["adult", "own", "purpose", "avatar-review-check", "outfit-review-check"])
    $(id).addEventListener("change", render);
  $("verify").addEventListener("click", () => void verify());
  $("generate-avatar").addEventListener("click", () => void generate("avatar"));
  $("generate-tryon").addEventListener("click", () => void generate("tryon"));
  $("avatar-approve").addEventListener("click", () => void approve());
  $("avatar-download").addEventListener("click", () => void download("avatar"));
  $("outfit-download").addEventListener("click", () => void download("outfit"));
  $("product-choice").addEventListener("change", () => void selectProduct());
  $("new-tryon").addEventListener("click", () => {
    clearAuthorization();
    phase = "tryon-consent";
    render();
    message("Confirm fresh consent for another preview. This uses another image attempt.");
  });
  $("body-type").addEventListener("change", () => {
    selectionTouched = false;
    bodyChoice(true);
  });
  $("profile").addEventListener("change", () => {
    selectionTouched = true;
    template();
    render();
  });
  $("tone").addEventListener("change", template);
  for (const id of ["height", "weight"]) $(id).addEventListener("input", () => bodyChoice(true));
  for (const kind of ["face", "body"]) {
    for (const source of ["file", "camera"])
      $(kind + "-" + source + "-button").addEventListener("click", () => {
        if (!busy && session && authorization) $(kind + "-" + source)?.click();
      });
    $(kind + "-remove").addEventListener("click", () => {
      if (busy) return;
      photoVersion[kind]++;
      photos[kind] = null;
      removeImage(kind + "-preview");
      $(kind + "-name").textContent = "No photo selected.";
      render();
    });
  }
  $("end").addEventListener("click", () => void finish());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void read();
  });
  window.addEventListener("pageshow", () => {
    if (session) void read();
  });
  window.addEventListener("pagehide", () => void finish());
  (async () => {
    const ticket = new URLSearchParams(location.hash.slice(1)).get("launch");
    history.replaceState(null, "", "/shopper");
    const current = epoch;
    try {
      const data = await api("session", ticket ? { method: "POST", body: { ticket } } : {});
      if (current !== epoch) return;
      update(data);
      if (data.shopperGenerationAvailable) {
        $("body-type").replaceChildren(
          ...[...new Set(data.workflow.profiles.map((p) => p.body))].map(
            (body) =>
              new Option(body === "male" ? "Male body reference" : "Female body reference", body),
          ),
        );
        $("tone").replaceChildren(...data.workflow.skinTones.map((t) => new Option(t.name, t.id)));
        $("tone").value = data.workflow.defaultTemplateTone;
        bodyChoice(true);
        await productChoices();
        if (current !== epoch || !session) return;
        message(
          phase === "lost"
            ? status.textContent
            : "Create a temporary avatar, then try this store’s product. No photo is sent until you explicitly generate.",
        );
      }
      timer = setInterval(tick, 1000);
      poller = setInterval(() => {
        if (!document.hidden) void read();
      }, 15000);
    } catch (e) {
      if (current === epoch) clear(e.message);
    }
  })();
}
