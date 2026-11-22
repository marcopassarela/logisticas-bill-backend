import {
  createHash,
  createPublicKey,
  randomBytes,
  verify,
  type KeyObject,
} from "node:crypto";

const PUBLIC_KEY_MIN_LENGTH = 100;
const PUBLIC_KEY_MAX_LENGTH = 512;

function decodeBase64(value: string, field: string): Buffer {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
    value.length % 4 !== 0
  ) {
    throw new Error(`${field} inválido.`);
  }

  const decoded = Buffer.from(value, "base64");

  if (decoded.toString("base64") !== value) {
    throw new Error(`${field} inválido.`);
  }

  return decoded;
}

export function parseDevicePublicKey(
  publicKeyBase64: string
): KeyObject {
  if (
    publicKeyBase64.length < PUBLIC_KEY_MIN_LENGTH ||
    publicKeyBase64.length > PUBLIC_KEY_MAX_LENGTH
  ) {
    throw new Error("Tamanho da chave pública inválido.");
  }

  const der = decodeBase64(publicKeyBase64, "Chave pública");

  const publicKey = createPublicKey({
    key: der,
    format: "der",
    type: "spki",
  });

  const details = publicKey.asymmetricKeyDetails;

  if (
    publicKey.asymmetricKeyType !== "ec" ||
    details?.namedCurve !== "prime256v1"
  ) {
    throw new Error("A chave precisa utilizar ECDSA P-256.");
  }

  return publicKey;
}

export function generateDeviceChallenge() {
  const challenge = randomBytes(32).toString("base64url");

  return {
    challenge,
    challengeHash: hashDeviceChallenge(challenge),
  };
}

export function hashDeviceChallenge(challenge: string): string {
  if (
    typeof challenge !== "string" ||
    challenge.length < 20 ||
    challenge.length > 128
  ) {
    throw new Error("Desafio inválido.");
  }

  return createHash("sha256")
    .update(challenge, "utf8")
    .digest("hex");
}

export function verifyDeviceSignature(
  publicKeyBase64: string,
  challenge: string,
  signatureBase64: string
): boolean {
  try {
    const publicKey = parseDevicePublicKey(publicKeyBase64);
    const signature = decodeBase64(signatureBase64, "Assinatura");

    // Web Crypto ECDSA P-256 utiliza assinatura IEEE-P1363 (r || s).
    if (signature.length !== 64) {
      return false;
    }

    return verify(
      "sha256",
      Buffer.from(challenge, "utf8"),
      {
        key: publicKey,
        dsaEncoding: "ieee-p1363",
      },
      signature
    );
  } catch {
    return false;
  }
}