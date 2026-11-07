/** Joins truthy class names: cx("msg", mine && "mine") */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
