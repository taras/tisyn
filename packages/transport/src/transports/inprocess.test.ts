import { inprocessTransport } from "./inprocess.js";
import { transportComplianceSuite } from "../transport-compliance.js";

transportComplianceSuite("inprocess", inprocessTransport);
