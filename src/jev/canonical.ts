import { canonicalJson } from "../data/canonical.js";
import type { JevBatchContext, JevRoleView } from "./model.js";

export function canonicalJevJson(value: JevBatchContext | JevRoleView): string {
  return canonicalJson(value);
}
