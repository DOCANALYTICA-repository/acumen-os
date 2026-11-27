/**
 * Next re-mounts template.tsx on every navigation, giving each route a soft enter animation.
 * Pure CSS (see .page-enter in globals.css): server-rendered pages are visible before any JavaScript runs.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
