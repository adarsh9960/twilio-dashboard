import { hash, verify } from "argon2";

const h = await hash("testpass", {
  type: import("argon2").argon2id,
  memoryCost: 2 ** 14,
  timeCost: 3,
  parallelism: 4,
});
console.log("hash:", h);
const ok = await verify(h, "testpass");
console.log("verify ok:", ok);
