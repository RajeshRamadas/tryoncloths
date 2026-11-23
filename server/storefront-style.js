export const storefrontCss = `
  :root {
    --ink: #242a23;
    --muted: #555f55;
    --paper: #f8f6ef;
    --surface: #fff;
    --line: #e2e0d5;
    --image-background: #edeae1;
    --radius: 20px;
    --display: Georgia, "Times New Roman", serif;
    --body: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 var(--body); }
  main {
    width: min(100%, 1216px);
    margin: auto;
    padding: max(28px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
      max(48px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  }
  h1, h2, h3, p, figure { margin: 0; }
  p { overflow-wrap: anywhere; white-space: pre-line; }
  a { color: inherit; }
  a:focus-visible { outline: 2px solid currentColor; outline-offset: 4px; }
  h2 { font: 400 clamp(27px, 4vw, 40px)/1.12 var(--display); letter-spacing: -.025em; }
  figcaption { margin-top: 7px; font-size: 13px; }
  .storefront-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, .9fr);
    align-items: center;
    overflow: hidden;
    border-radius: calc(var(--radius) + 4px);
    background: var(--brand);
    color: var(--brand-ink);
  }
  .storefront-hero.compact { grid-template-columns: 1fr; }
  .hero-copy { padding: clamp(26px, 5.6vw, 70px); }
  .hero-copy .store-brand { margin: 0; padding: 0; background: transparent; }
  .hero-copy .store-brand h1 {
    margin: 0;
    font: 400 clamp(36px, 6.5vw, 76px)/1 var(--display);
    letter-spacing: -.045em;
    overflow-wrap: anywhere;
  }
  .hero-copy .store-brand .store-logo { max-width: 150px; max-height: 56px; margin-bottom: 18px; }
  .tagline { max-width: 30ch; margin-top: 16px; font-size: clamp(16px, 2vw, 20px); }
  .shop-actions, .shop-socials { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
  .shop-actions { margin-top: 24px; }
  .shop-socials { margin-top: 18px; gap: 6px 16px; font-size: 14px; }
  .shop-socials a { display: inline-flex; align-items: center; min-height: 44px; text-underline-offset: 4px; }
  .shop-actions a, .item-actions .try, .store-contact nav a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 8px 16px;
    border-radius: 999px;
    text-decoration: none;
    font-weight: 650;
    line-height: 1.3;
  }
  .shop-actions .cta { background: var(--brand-ink); color: var(--brand); }
  .shop-actions .secondary { border: 1px solid currentColor; }
  .shop-actions a:hover, .item-actions a:hover, .store-contact nav a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .shop-cover {
    align-self: stretch;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    min-width: 0;
    padding: 12px;
  }
  .shop-cover .hero {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 320px;
    max-height: 480px;
    aspect-ratio: 5/4;
    object-fit: cover;
    border-radius: calc(var(--radius) - 4px);
    background: var(--image-background);
  }
  .shop-cover.product-cover .hero { object-fit: contain; padding: clamp(18px, 4vw, 44px); }

  .collection { margin-top: clamp(34px, 6vw, 64px); scroll-margin-block-start: 20px; }
  .collection h2, .shop-gallery h2 { margin-bottom: 8px; }
  .collection-copy p { max-width: 60ch; color: var(--muted); }
  .gallery, .items {
    display: grid;
    gap: clamp(10px, 2vw, 20px);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 208px), 1fr));
    margin-top: 18px;
  }
  .item {
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .item img, .gallery img {
    display: block;
    width: 100%;
    aspect-ratio: 4/5;
    object-fit: cover;
    background: var(--image-background);
  }
  .item img { object-fit: contain; background: var(--surface); }
  .gallery img { border-radius: var(--radius); }
  .item-details { display: flex; flex-direction: column; flex: 1; padding: clamp(10px, 2vw, 18px); }
  .item h3 { font-size: clamp(15px, 2vw, 18px); line-height: 1.3; overflow-wrap: anywhere; }
  .item small { color: var(--muted); margin-top: 4px; }
  .item .price { font-weight: 700; margin-top: 7px; }
  .item s { display: inline-block; color: var(--muted); font-weight: 400; margin-left: 6px; }
  .item .low { color: #8b521a; font-size: 14px; margin-top: 4px; }
  .item-actions { display: grid; gap: 6px; margin-top: auto; padding-top: 12px; font-size: 14px; }
  .item-actions .try { background: var(--brand); color: var(--brand-ink); text-align: center; }
  .item-actions a:not(.try) { display: flex; align-items: center; min-height: 44px; }
  .shop-gallery, .info, .empty-collection, .powered { margin-top: 32px; }
  .info { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); }
  .info section, .store-contact {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 20px 24px;
  }
  .info h2 { margin-bottom: 6px; font-size: 25px; }
  .store-contact { margin: 28px 0 0; }
  .store-contact nav { gap: 10px; }
  .store-contact nav a { border: 1px solid var(--line); }
  .store-contact p { margin-bottom: 8px; }
  .powered { color: var(--muted); border-top: 1px solid var(--line); padding-top: 18px; font-size: 13px; }
  .preview { margin-bottom: 12px; padding: 10px 14px; border-radius: 10px; background: #fdf6e7; color: #93500b; }
  @media (min-width: 960px) {
    .collection { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2.65fr); gap: 28px; }
    .collection .items { margin-top: 0; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
    .items > .item:only-child { max-width: 400px; }
    .item img { max-height: 290px; }
  }
  @media (max-width: 700px) {
    main { padding-inline: max(14px, env(safe-area-inset-left)) max(14px, env(safe-area-inset-right)); }
    .storefront-hero { grid-template-columns: 1fr; }
    .hero-copy { padding: 26px 22px 14px; }
    .storefront-hero.compact .hero-copy { padding-bottom: 28px; }
    .shop-cover .hero { min-height: 0; height: auto; max-height: 245px; aspect-ratio: 16/10; }
    .shop-cover.product-cover .hero { padding: 14px; }
    .items, .gallery { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .item-actions .try { border-radius: 12px; padding-inline: 7px; font-size: 13px; }
  }
`;
