const API = "https://api.stellar.expert";
const NETWORK = "public";

const XRP262_ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const XRP262_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";
const LEXORA =
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";
const XRP262_CODE = "XRP262";
const XRP262_DECIMALS = 7;

async function get(path) {
  const response = await fetch(API + path, {
    headers: { accept: "application/json" },
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { status: response.status, body };
}

function printResult(label, result) {
  console.log(label, `HTTP ${result.status}`);
  console.dir(result.body, { depth: 8 });
  console.log("");
}

function recordsFrom(result) {
  return Array.isArray(result.body?._embedded?.records)
    ? result.body._embedded.records
    : [];
}

function metadataFields(record) {
  return {
    domain: record?.domain ?? null,
    tomlInfo: record?.tomlInfo ?? null,
    toml: record?.toml ?? null,
  };
}

async function main() {
  console.log("XRP262 STELLAREXPERT INDEX CHECK");
  console.log("================================");
  console.log("Issuer:", XRP262_ISSUER);
  console.log("SAC:", XRP262_SAC);
  console.log("Lexora:", LEXORA);
  console.log("");

  const assetSearch = await get(
    `/explorer/${NETWORK}/asset?search=${XRP262_CODE}&limit=200`,
  );
  printResult("Asset search:", assetSearch);

  const issuerSearch = await get(
    `/explorer/${NETWORK}/asset?search=${XRP262_ISSUER}&limit=200`,
  );
  printResult("Issuer search:", issuerSearch);

  const directorySearch = await get(
    `/explorer/directory?address[]=${LEXORA}&limit=10`,
  );
  printResult("Lexora directory entry:", directorySearch);

  const candidates = [
    ...recordsFrom(assetSearch),
    ...recordsFrom(issuerSearch),
  ];

  const indexed = candidates.find(
    (record) =>
      record?.code === XRP262_CODE &&
      String(record?.asset ?? "").includes(XRP262_ISSUER),
  );

  if (!indexed) {
    throw new Error(
      "XRP262 exact code/issuer combination was not found in StellarExpert index.",
    );
  }

  const indexedAssetId = indexed.asset;

  console.log("Exact indexed asset:", indexedAssetId);
  console.log("");

  const assetDetails = await get(
    `/explorer/${NETWORK}/asset/${encodeURIComponent(indexedAssetId)}`,
  );
  printResult("Exact indexed asset lookup:", assetDetails);

  const supply = await get(
    `/explorer/${NETWORK}/asset/${encodeURIComponent(indexedAssetId)}/supply`,
  );
  printResult("Exact indexed asset supply lookup:", supply);

  const exact = assetDetails.body && typeof assetDetails.body === "object"
    ? assetDetails.body
    : indexed;

  const contractMatches = exact?.contract === XRP262_SAC;
  const decimalsMatch = Number(exact?.decimals) === XRP262_DECIMALS;
  const issuerMatches = String(exact?.asset ?? "").includes(XRP262_ISSUER);

  const metadata = metadataFields(exact);
  const metadataIndexed =
    metadata.domain !== null ||
    metadata.tomlInfo !== null ||
    metadata.toml !== null;

  console.log("STELLAREXPERT VALIDATION");
  console.log("========================");
  console.log("Exact asset ID:", indexedAssetId);
  console.log("Code:", exact?.code ?? "missing");
  console.log("Issuer match:", issuerMatches ? "PASS" : "FAIL");
  console.log("SAC contract:", exact?.contract ?? "missing");
  console.log(
    "SAC contract = expected SAC:",
    contractMatches ? "PASS" : "FAIL",
  );
  console.log(
    "Decimals = 7:",
    decimalsMatch ? "PASS" : "FAIL",
  );
  console.log("Supply:", exact?.supply ?? "missing");
  console.log("Trustlines:", exact?.trustlines ?? "missing");
  console.log("Trades:", exact?.trades ?? "missing");
  console.log("Payments:", exact?.payments ?? "missing");
  console.log("");

  console.log("Metadata fields:");
  console.dir(metadata, { depth: 8 });
  console.log(
    "Metadata indexing:",
    metadataIndexed ? "INDEXED" : "NOT YET INDEXED",
  );
  console.log("");

  if (!issuerMatches || !contractMatches || !decimalsMatch) {
    throw new Error("StellarExpert XRP262 identity validation FAILED.");
  }

  console.log("XRP262 STELLAREXPERT IDENTITY CHECK: PASS");
  console.log(
    "StellarExpert explicitly associates XRP262 with the expected SAC.",
  );
  console.log(
    metadataIndexed
      ? "StellarExpert has indexed at least one metadata field."
      : "StellarExpert has not indexed domain/TOML metadata yet.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
