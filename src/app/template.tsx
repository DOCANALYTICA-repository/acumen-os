import { PageTransition } from "@/components/motion";

/** Next re-mounts template.tsx on every navigation, giving each route a soft enter animation. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
