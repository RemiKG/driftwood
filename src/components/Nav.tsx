"use client";
import { usePathname, useRouter } from "next/navigation";

const ITEMS = [
  { href: "/shore", label: "The Shore", ic: "◎" },
  { href: "/shape-diff", label: "Shape Diff", ic: "⇄" },
  { href: "/verdicts", label: "Verdicts", ic: "▣" },
  { href: "/fingerprints", label: "Fingerprints", ic: "◇" },
  { href: "/drift-lab", label: "Drift Lab", ic: "⚑" },
  { href: "/settings", label: "Settings", ic: "⚙" },
];

export default function Nav() {
  const path = usePathname();
  const router = useRouter();
  return (
    <nav className="nav">
      <div className="brand" onClick={() => router.push("/shore")} style={{ cursor: "pointer" }}>
        Driftwood<span className="pip">.</span>
      </div>
      {ITEMS.map((it) => (
        <div
          key={it.href}
          className={"navlink" + (path?.startsWith(it.href) ? " on" : "")}
          onClick={() => router.push(it.href)}
        >
          <span className="ic">{it.ic}</span> {it.label}
        </div>
      ))}
      <div className="spacer" />
      <div className="me">
        <span className="av">R</span> on-call SRE
      </div>
    </nav>
  );
}
