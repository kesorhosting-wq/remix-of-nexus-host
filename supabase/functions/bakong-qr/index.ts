import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BAKONG_TOKEN = Deno.env.get("BAKONG_TOKEN");

const BAKONG_API_URL = "https://api-bakong.nbc.gov.kh";
const USD_TO_KHR_RATE = 4100;

/* ---------------------------------------------------------
   PURE JAVASCRIPT MD5 (WORKS IN SUPABASE EDGE FUNCTIONS)
--------------------------------------------------------- */
function md5(str: string) {
  function L(k: number, d: number) {
    return (k << d) | (k >>> (32 - d));
  }
  function K(G: number, k: number) {
    return (G + k) & 0xffffffff;
  }
  function F(x: number, y: number, z: number) {
    return (x & y) | (~x & z);
  }
  function G(x: number, y: number, z: number) {
    return (x & z) | (y & ~z);
  }
  function H(x: number, y: number, z: number) {
    return x ^ y ^ z;
  }
  function I(x: number, y: number, z: number) {
    return y ^ (x | ~z);
  }

  function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = K(a, K(K(F(b, c, d), x), ac));
    return K(L(a, s), b);
  }
  function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = K(a, K(K(G(b, c, d), x), ac));
    return K(L(a, s), b);
  }
  function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = K(a, K(K(H(b, c, d), x), ac));
    return K(L(a, s), b);
  }
  function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number) {
    a = K(a, K(K(I(b, c, d), x), ac));
    return K(L(a, s), b);
  }

  function toWordArray(str: string) {
    const l = str.length;
    const n = (((l + 8) >> 6) + 1) * 16;
    const wordArray = new Array(n - 1).fill(0);

    let byteCount = 0;
    while (byteCount < l) {
      const idx = (byteCount >> 2);
      const shift = (byteCount % 4) * 8;
      wordArray[idx] |= str.charCodeAt(byteCount) << shift;
      byteCount++;
    }

    const idx = (byteCount >> 2);
    const shift = (byteCount % 4) * 8;
    wordArray[idx] |= 0x80 << shift;

    wordArray[n - 2] = l << 3;
    return wordArray;
  }

  function toHex(num: number) {
    let hex = "";
    for (let j = 0; j <= 3; j++) {
      const b = (num >> (j * 8)) & 255;
      hex += ("0" + b.toString(16)).slice(-2);
    }
    return hex;
  }

  const x = toWordArray(str);
  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < x.length; i += 16) {
    let [aa, bb, cc, dd] = [a, b, c, d];

    a = FF(a, b, c, d, x[i + 0], 7, -680876936);
    d = FF(d, a, b, c, x[i + 1], 12, -389564586);
    c = FF(c, d, a, b, x[i + 2], 17, 606105819);
    b = FF(b, c, d, a, x[i + 3], 22, -1044525330);
    a = FF(a, b, c, d, x[i + 4], 7, -176418897);
    d = FF(d, a, b, c, x[i + 5], 12, 1200080426);
    c = FF(c, d, a, b, x[i + 6], 17, -1473231341);
    b = FF(b, c, d, a, x[i + 7], 22, -45705983);
    a = FF(a, b, c, d, x[i + 8], 7, -1958414417);
    d = FF(d, a, b, c, x[i + 9], 12, -42063);
    c = FF(c, d, a, b, x[i + 10], 17, -1990404162);
    b = FF(b, c, d, a, x[i + 11], 22, 1804603682);
    a = FF(a, b, c, d, x[i + 12], 7, -40341101);
    d = FF(d, a, b, c, x[i + 13], 12, -1502002290);
    c = FF(c, d, a, b, x[i + 14], 17, 1236535329);
    b = FF(b, c, d, a, x[i + 15], 22, -165796510);

    a = GG(a, b, c, d, x[i + 1], 5, -165796510);
    d = GG(d, a, b, c, x[i + 6], 9, -1069501632);
    c = GG(c, d, a, b, x[i + 11], 14, 643717713);
    b = GG(b, c, d, a, x[i + 0], 20, -373897302);
    a = GG(a, b, c, d, x[i + 5], 5, -701558691);
    d = GG(d, a, b, c, x[i + 10], 9, 38016083);
    c = GG(c, d, a, b, x[i + 15], 14, -660478335);
    b = GG(b, c, d, a, x[i + 4], 20, -405537848);
    a = GG(a, b, c, d, x[i + 9], 5, 568446438);
    d = GG(d, a, b, c, x[i + 14], 9, -1019803690);
    c = GG(c, d, a, b, x[i + 3], 14, -187363961);
    b = GG(b, c, d, a, x[i + 8], 20, 1163531501);
    a = GG(a, b, c, d, x[i + 13], 5, -1444681467);
    d = GG(d, a, b, c, x[i + 2], 9, -51403784);
    c = GG(c, d, a, b, x[i + 7], 14, 1735328473);
    b = GG(b, c, d, a, x[i + 12], 20, -1926607734);

    a = HH(a, b, c, d, x[i + 5], 4, -378558);
    d = HH(d, a, b, c, x[i + 8], 11, -2022574463);
    c = HH(c, d, a, b, x[i + 11], 16, 1839030562);
    b = HH(b, c, d, a, x[i + 14], 23, -35309556);
    a = HH(a, b, c, d, x[i + 1], 4, -1530992060);
    d = HH(d, a, b, c, x[i + 4], 11, 1272893353);
    c = HH(c, d, a, b, x[i + 7], 16, -155497632);
    b = HH(b, c, d, a, x[i + 10], 23, -1094730640);
    a = HH(a, b, c, d, x[i + 13], 4, 681279174);
    d = HH(d, a, b, c, x[i + 0], 11, -358537222);
    c = HH(c, d, a, b, x[i + 3], 16, -722521979);
    b = HH(b, c, d, a, x[i + 6], 23, 76029189);
    a = HH(a, b, c, d, x[i + 9], 4, -640364487);
    d = HH(d, a, b, c, x[i + 12], 11, -421815835);
    c = HH(c, d, a, b, x[i + 15], 16, 530742520);
    b = HH(b, c, d, a, x[i + 2], 23, -995338651);

    a = II(a, b, c, d, x[i + 0], 6, -198630844);
    d = II(d, a, b, c, x[i + 7], 10, 1126891415);
    c = II(c, d, a, b, x[i + 14], 15, -1416354905);
    b = II(b, c, d, a, x[i + 5], 21, -57434055);
    a = II(a, b, c, d, x[i + 12], 6, 1700485571);
    d = II(d, a, b, c, x[i + 3], 10, -1894986606);
    c = II(c, d, a, b, x[i + 10], 15, -1051523);
    b = II(b, c, d, a, x[i + 1], 21, -2054922799);
    a = II(a, b, c, d, x[i + 8], 6, 1873313359);
    d = II(d, a, b, c, x[i + 15], 10, -30611744);
    c = II(c, d, a, b, x[i + 6], 15, -1560198380);
    b = II(b, c, d, a, x[i + 13], 21, 1309151649);
    a = II(a, b, c, d, x[i + 4], 6, -145523070);
    d = II(d, a, b, c, x[i + 11], 10, -1120210379);
    c = II(c, d, a, b, x[i + 2], 15, 718787259);
    b = II(b, c, d, a, x[i + 9], 21, -343485551);

    a = K(a, aa);
    b = K(b, bb);
    c = K(c, cc);
    d = K(d, dd);
  }

  return (toHex(a) + toHex(b) + toHex(c) + toHex(d)).toLowerCase();
}

/* ---------------------------------------------------------
   TLV HELPER FUNCTIONS
--------------------------------------------------------- */
function tlv(tag: string, value: string): string {
  const length = value.length.toString().padStart(2, "0");
  return tag + length + value;
}

/* ---------------------------------------------------------
   KHQR GENERATOR (FIXED - PROPER EMVCo FORMAT)
--------------------------------------------------------- */
function generateKHQRString(payload: {
  accountId: string;        // Bakong account ID format: username@bankcode
  merchantName: string;
  merchantCity: string;
  currency: string;
  amount: string;
  billNumber: string;
}): string {
  let qrString = "";

  // Tag 00: Payload Format Indicator (Fixed: "01")
  qrString += tlv("00", "01");

  // Tag 01: Point of Initiation Method (12 = Dynamic QR)
  qrString += tlv("01", "12");

  // Tag 29: Merchant Account Information (Bakong)
  // Sub-tag 00: Globally Unique Identifier = "bakong"
  // Sub-tag 01: Account ID (username@bankcode format)
  const tag29Content = tlv("00", "bakong") + tlv("01", payload.accountId);
  qrString += tlv("29", tag29Content);

  // Tag 52: Merchant Category Code (5999 = Miscellaneous)
  qrString += tlv("52", "5999");

  // Tag 53: Transaction Currency (840 = USD, 116 = KHR)
  const currencyCode = payload.currency === "USD" ? "840" : "116";
  qrString += tlv("53", currencyCode);

  // Tag 54: Transaction Amount
  if (payload.amount && parseFloat(payload.amount) > 0) {
    qrString += tlv("54", payload.amount);
  }

  // Tag 58: Country Code
  qrString += tlv("58", "KH");

  // Tag 59: Merchant Name
  const merchantName = payload.merchantName.substring(0, 25);
  qrString += tlv("59", merchantName);

  // Tag 60: Merchant City
  const merchantCity = payload.merchantCity.substring(0, 15);
  qrString += tlv("60", merchantCity);

  // Tag 62: Additional Data Field Template
  if (payload.billNumber) {
    const billNumber = payload.billNumber.substring(0, 25);
    // Sub-tag 01: Bill Number
    const tag62Content = tlv("01", billNumber);
    qrString += tlv("62", tag62Content);
  }

  // Tag 63: CRC (placeholder, will be calculated)
  qrString += "6304";

  // Calculate and append CRC16
  const crc = calculateCRC16(qrString);
  qrString += crc;

  return qrString;
}

function calculateCRC16(str: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
    }
    crc &= 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/* ---------------------------------------------------------
   QR IMAGE GENERATOR
--------------------------------------------------------- */
async function generateQRCodeImage(data: string): Promise<string> {
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(data)}`;

  const response = await fetch(qrApiUrl);
  const arrayBuffer = await response.arrayBuffer();
  return btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
}

/* ---------------------------------------------------------
   MAIN EDGE FUNCTION
--------------------------------------------------------- */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { amount, currency, orderId, invoiceId, description, userId, action } = await req.json();

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    /* -------------------------------
       CHECK PAYMENT STATUS
    ------------------------------- */
    if (action === "check-payment") {
      if (!BAKONG_TOKEN) throw new Error("BAKONG_TOKEN not configured");

      const { data: payment } = await supabase
        .from("payments")
        .select("gateway_response")
        .eq("transaction_id", orderId)
        .maybeSingle();

      const md5Hash = payment?.gateway_response?.md5_hash;
      if (!md5Hash) throw new Error("No MD5 hash found for this transaction");

      console.log(`[CHECK] Checking payment status for MD5: ${md5Hash}`);

      const checkResponse = await fetch(`${BAKONG_API_URL}/v1/check_transaction_by_md5`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${BAKONG_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ md5: md5Hash }),
      });

      const checkResult = await checkResponse.json();
      console.log(`[CHECK] Bakong response:`, JSON.stringify(checkResult));

      return new Response(
        JSON.stringify({
          success: true,
          status: checkResult.responseCode === 0 && checkResult.data?.hash ? "paid" : "pending",
          data: checkResult,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    /* -------------------------------
       GENERATE QR CODE
    ------------------------------- */
    if (!amount || !orderId) {
      throw new Error("Missing required fields: amount, orderId");
    }

    const { data: gatewayConfig } = await supabase
      .from("payment_gateways")
      .select("config")
      .eq("slug", "bakong")
      .maybeSingle();

    const config = gatewayConfig?.config || {};
    
    // IMPORTANT: accountId must be in format "username@bankcode" 
    // e.g., "kanika_kan16@aclb" or "yourname@wing"
    const accountId = config.accountId || config.merchantId || "";
    const merchantName = config.merchantName || "GameHost";
    const merchantCity = config.merchantCity || "Phnom Penh";
    const configCurrency = config.currency || "USD";

    if (!accountId || !accountId.includes("@")) {
      throw new Error("Invalid Bakong account ID. Must be in format: username@bankcode (e.g., myname@aclb)");
    }

    console.log(`[GENERATE] Creating KHQR for account: ${accountId}, amount: ${amount} ${currency}`);

    let finalCurrency = configCurrency;
    let finalAmount = parseFloat(amount);

    if (configCurrency === "KHR" && currency === "USD") {
      finalAmount = Math.round(finalAmount * USD_TO_KHR_RATE);
    }

    const khqrPayload = {
      accountId,
      merchantName,
      merchantCity,
      currency: finalCurrency,
      amount: finalCurrency === "KHR" ? finalAmount.toFixed(0) : finalAmount.toFixed(2),
      billNumber: orderId.substring(0, 25),
    };

    const qrString = generateKHQRString(khqrPayload);
    const md5Hash = md5(qrString);

    console.log(`[GENERATE] QR String: ${qrString}`);
    console.log(`[GENERATE] MD5 Hash: ${md5Hash}`);

    const qrCodeBase64 = await generateQRCodeImage(qrString);

    if (userId) {
      await supabase.from("payments").insert({
        amount: finalAmount,
        currency: finalCurrency,
        status: "pending",
        invoice_id: invoiceId || null,
        user_id: userId,
        transaction_id: orderId,
        gateway_response: {
          khqr_payload: khqrPayload,
          md5_hash: md5Hash,
          qr_string: qrString,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        qrCode: qrCodeBase64,
        qrString,
        md5Hash,
        transactionId: orderId,
        currency: finalCurrency,
        amount: finalAmount,
        exchangeRate: finalCurrency === "KHR" && currency === "USD" ? USD_TO_KHR_RATE : null,
        originalAmount: amount,
        originalCurrency: currency,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: any) {
    console.error(`[ERROR] ${error.message}`);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
