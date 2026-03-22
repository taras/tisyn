import { inprocessTransport } from "./inprocess-transport.js";
import { transportComplianceSuite } from "./transport-compliance.js";

transportComplianceSuite("inprocess", inprocessTransport);
