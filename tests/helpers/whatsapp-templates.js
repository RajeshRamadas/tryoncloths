export function metaTemplate(name, overrides) {
  return {
    name,
    language: "en_US",
    status: "APPROVED",
    category: name === "look_share" ? "UTILITY" : "MARKETING",
    components: [
      { type: "HEADER", format: "IMAGE" },
      { type: "BODY", text: "Hi {{1}}, here are your outfits from {{2}}." },
      {
        type: "BUTTONS",
        buttons: [
          { type: "URL", text: "See outfits", url: "https://studio.example.test/w/{{1}}" },
          ...(name === "new_arrivals" ? [{ type: "QUICK_REPLY", text: "STOP" }] : []),
        ],
      },
    ],
    ...overrides,
  };
}
