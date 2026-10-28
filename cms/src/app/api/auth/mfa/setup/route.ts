import QRCode from "qrcode";
import { startMfaEnrollment } from "@/server/auth";
import { route } from "@/server/web";

export const POST = route({}, async ({ db, auth }) => {
  const { secret, uri } = startMfaEnrollment(db, auth);
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
  return { secret, uri, qrSvg: `data:image/svg+xml;utf8,${encodeURIComponent(qr)}` };
});
