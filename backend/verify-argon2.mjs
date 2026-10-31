import { hash, verify } from "argon2";
const password = "mdnwvrhez3mryinbdi7r226hdy======";
const h = await hash(password, {
  type: import("argon2").argon2id,
  memoryCost: 2 ** 14,
  timeCost: 3,
  parallelism: 4,
});
console.log("ADMIN_HASH_BASE64=" + h);
const ok = await verify(h, password);
console.log("verify ok:", ok);
