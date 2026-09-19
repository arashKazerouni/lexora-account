const API = "https://api.stellar.expert";
const NETWORK = "public";

const XRP262_ISSUER =
  "GCGVZEE7RD2BFF2EIQUT37DYJUR7WDCQ2KWA5LUWYATRFLKEYHMJ3XRP";
const XRP262_SAC =
  "CC7L34EWYCTDCA3L7CRRULWX577UJWET32KNJFD2WTEQ4KD7IAUKHIS6";
const LEXORA =
  "CAJL2JO6EILWBTHDRMIQVJA6MTZIUWHOD6WNVJDN7FWTYD6H3NFXH542";

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
  console.dir(result.body, { depth: 6 });
  console.log("");
}

async function main() {
  console.log("XRP262 STELLAREXPERT INDEX CHECK");
  console.log("================================");
  console.log("Issuer:", XRP262_ISSUER);
  console.log("SAC:", XRP262_SAC);
  console.log("Lexora:", LEXORA);
  console.log("");

  const assetSearch = await get(
    `/explorer/${NETWORK}/asset?search=XRP262&limit=200`,
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

  const assetId = `XRP262-${XRP262_ISSUER}-1`;

  const assetDetails = await get(
    `/explorer/${NETWORK}/asset/${assetId}`,
  );
  printResult("Classic asset lookup:", assetDetails);

  const supply = await get(
    `/explorer/${NETWORK}/asset/${assetId}/supply`,
  );
  printResult("Classic asset supply lookup:", supply);

  const found = Array.isArray(assetSearch.body?._embedded?.records)
    ? assetSearch.body._embedded.records.some((record) =>
        String(record.asset ?? "").includes(XRP262_ISSUER),
      )
    : false;

  console.log("XRP262 issuer indexed as a classic Stellar asset:", found);
  console.log(
    "Note: XRP262 authoritative identity is the Soroban SAC plus Lexora policy/registry state.",
  );
  console.log(
    "A missing classic-asset result does not change the verified SAC/admin/policy state.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
