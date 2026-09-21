import assert from "node:assert/strict";
import test from "node:test";

import { CredentialVault } from "../src/credential-vault.ts";

test("credential vault round trips and rejects tampering or wrong context", async () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const vault = await CredentialVault.fromRawKey(key);
  const encrypted = await vault.encrypt("refresh-token", { tenantId: "t1", shopId: "s1", version: 3 });
  assert.notEqual(encrypted.ciphertext, "refresh-token");
  assert.equal(await vault.decrypt(encrypted, { tenantId: "t1", shopId: "s1", version: 3 }), "refresh-token");
  await assert.rejects(() => vault.decrypt(encrypted, { tenantId: "t1", shopId: "other", version: 3 }));
  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` };
  await assert.rejects(() => vault.decrypt(tampered, { tenantId: "t1", shopId: "s1", version: 3 }));
});
