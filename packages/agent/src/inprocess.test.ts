import { inprocessTransport } from "./inprocess-transport.js";
import { transportComplianceSuite } from "./transport-compliance.test.js";

transportComplianceSuite("inprocess", inprocessTransport);
