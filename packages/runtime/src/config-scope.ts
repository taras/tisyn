/**
 * Runtime-internal config context.
 *
 * Holds the resolved config projection for the current execution scope.
 * Seeded by execute() from ExecuteOptions.config and read by __config
 * effect dispatch via ConfigContext.expect().
 */

import { createContext } from "effection";
import type { Val } from "@tisyn/ir";

export const ConfigContext = createContext<Val>("$config", null);
