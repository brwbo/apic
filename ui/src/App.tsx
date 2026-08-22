import Hero from "@/components/hero";

/** `?still=1` freezes the backdrop for slide exports; `?t=` picks the frame. */
const q = new URLSearchParams(window.location.search);
const still = q.get("still") === "1";
const stillTime = Number(q.get("t") ?? 1.0);

export default function App() {
  return <Hero still={still} stillTime={stillTime} />;
}
