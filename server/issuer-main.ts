import { createIssuer, issuerConfiguration } from "./issuer";

const config = issuerConfiguration();
createIssuer(config).listen(config.port, "0.0.0.0", () => console.log("Supdance OAuth issuer listening"));
