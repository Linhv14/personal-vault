import { Hono } from "hono";
import {
  checkBiometric,
  clearBiometric,
  isAssertion,
  isRegistration,
  issueBiometricChallenge,
  setBiometric,
} from "../biometric.js";
import { apiError } from "../errors.js";
import { now, readJson } from "../http.js";
import { checkPin, clearPin, isVerifier, setPin, verifierHash } from "../pin.js";
import type { AppBindings } from "../types.js";

const deviceUnlock = new Hono<AppBindings>();

deviceUnlock.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

deviceUnlock.put("/pin", async (c) => {
  const { verifier } = await readJson(c);
  if (!isVerifier(verifier)) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  const pinKey = await setPin(
    c.env,
    c.get("session").tokenHash,
    await verifierHash(c.env, verifier),
  );
  return c.json({ pinKey });
});

deviceUnlock.delete("/pin", async (c) => {
  await clearPin(c.env, c.get("session").tokenHash);
  return c.json({ ok: true });
});

deviceUnlock.post("/pin/unlock", async (c) => {
  const { verifier } = await readJson(c);
  if (!isVerifier(verifier)) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  const result = await checkPin(
    c.env,
    c.get("session").tokenHash,
    await verifierHash(c.env, verifier),
  );
  if (result.ok) {
    return c.json({ pinKey: result.pinKey });
  }
  if (result.attemptsLeft === 0) {
    return c.json(apiError("auth.pin_off"), 410);
  }
  return c.json(apiError("auth.pin_wrong", { count: result.attemptsLeft }), 403);
});

deviceUnlock.put("/biometric", async (c) => {
  const body = await readJson(c);
  if (!isRegistration(body)) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  return c.json({ bioKey: await setBiometric(c.env, c.get("session").tokenHash, body) });
});

deviceUnlock.delete("/biometric", async (c) => {
  await clearBiometric(c.env, c.get("session").tokenHash);
  return c.json({ ok: true });
});

deviceUnlock.post("/biometric/challenge", async (c) => {
  const issued = await issueBiometricChallenge(c.env, c.get("session").tokenHash, now());
  return issued ? c.json(issued) : c.json(apiError("auth.biometric_off"), 410);
});

deviceUnlock.post("/biometric/unlock", async (c) => {
  const body = await readJson(c);
  if (!isAssertion(body)) {
    return c.json(apiError("auth.invalid_body"), 400);
  }
  const bioKey = await checkBiometric(c.env, c.get("session").tokenHash, body, now());
  return bioKey ? c.json({ bioKey }) : c.json(apiError("auth.biometric_failed"), 403);
});

export default deviceUnlock;
