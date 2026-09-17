export function buildStoryboard({duration=10, hook="", product="", motion="", format="9:16"}) {
  const d = Number(duration);
  const shots = d <= 10 ? 2 : d <= 15 ? 3 : 5;
  const per = d / shots;
  const safeHook = hook || "Stop scrolling — lihat detail produk ini.";
  const safeProduct = product || "produk";
  const safeMotion = motion || "slow cinematic push-in";

  return Array.from({length: shots}, (_, i) => ({
    index: i + 1,
    duration: Number(per.toFixed(2)),
    prompt: `${safeMotion}. Shot ${i+1}/${shots}. Showcase ${safeProduct} with premium commercial lighting, realistic materials, clean composition, natural motion, consistent product geometry, no text baked into image. Format ${format}.`,
    textOverlay: i === 0 ? safeHook : i === shots - 1 ? "Cek detail & ambil kesempatanmu." : ""
  }));
}
