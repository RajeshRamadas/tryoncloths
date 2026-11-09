// Identical geometry and text wrapping for the browser preview and saved board.
export function completeLayout(labels, preview = "Overlay preview") {
  const width = 1024,
    bodyHeight = 1536,
    margin = 28,
    insetWidth = Math.round(width * 0.4),
    insetHeight = Math.round((insetWidth * 4) / 3),
    lineHeight = 48;
  const wrapped = labels.map((label) => {
    const chars = Array.from(label),
      lines = [];
    let line = "";
    for (const word of chars.join("").split(/\s+/)) {
      let rest = word;
      if (line && Array.from(line + " " + rest).length > 20) {
        lines.push(line);
        line = "";
      }
      while (Array.from(rest).length > 20) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(Array.from(rest).slice(0, 20).join(""));
        rest = Array.from(rest).slice(20).join("");
      }
      line += (line ? " " : "") + rest;
    }
    if (line) lines.push(line);
    return lines;
  });
  const text = [];
  let y = bodyHeight + 150;
  for (let i = 0; i < wrapped.length; i += 2) {
    for (let j = 0; j < 2; j++)
      for (const [k, line] of (wrapped[i + j] || []).entries())
        text.push({ text: line, x: margin + (j * width) / 2, y: y + k * lineHeight });
    y += Math.max(wrapped[i].length, wrapped[i + 1]?.length || 0) * lineHeight + 16;
  }
  const split = preview.lastIndexOf(" ", 45),
    previewLines =
      Array.from(preview).length > 45 && split > 0
        ? [preview.slice(0, split), preview.slice(split + 1)]
        : [preview];
  return {
    width,
    height: Math.max(bodyHeight + 250, y + 140),
    bodyHeight,
    margin,
    inset: {
      x: width - margin - insetWidth,
      y: margin,
      width: insetWidth,
      height: insetHeight,
      radius: 20,
    },
    text,
    preview,
    previewLines,
    fonts: { title: 44, item: 38, preview: 36 },
  };
}
