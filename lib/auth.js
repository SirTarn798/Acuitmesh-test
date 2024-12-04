import { SignJWT, jwtVerify } from "jose";

const key = new TextEncoder().encode(process.env.SECRET_KEY);

export async function encrypt(payload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1 day from now")
    .sign(key);
}

export async function decrypt(input) {
  const { payload } = await jwtVerify(input, key, {
    algorithms: ["HS256"],
  });
  return payload;
}

