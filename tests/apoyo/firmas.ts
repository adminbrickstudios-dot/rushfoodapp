import { createHmac, createHash } from 'node:crypto'

const b64url = (b: Buffer): string => b.toString('base64url')

/** Firma X-Hub-Signature-256 tal cual la calcula Meta. */
export function firmaMeta(cuerpo: string | Buffer, appSecret: string): string {
  const buf = typeof cuerpo === 'string' ? Buffer.from(cuerpo, 'utf8') : cuerpo
  return 'sha256=' + createHmac('sha256', appSecret).update(buf).digest('hex')
}

/**
 * Firma Upstash-Signature, generada de verdad y no mockeada.
 *
 * El Receiver de QStash valida un JWT HS256 con issuer "Upstash" y un
 * claim `body` que es el SHA-256 del cuerpo en base64url. Se arma acá
 * a mano para que el test ejercite el verificador real del SDK en vez
 * de una imitación.
 */
export function firmaQStash(
  cuerpo: string,
  signingKey: string,
  opciones: { url?: string; expiraEn?: number } = {},
): string {
  const ahora = Math.floor(Date.now() / 1000)

  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: 'Upstash',
    sub: opciones.url ?? 'https://rushfood.test/api/whatsapp/procesar',
    iat: ahora,
    nbf: ahora - 10,
    exp: ahora + (opciones.expiraEn ?? 300),
    jti: Math.random().toString(36).slice(2),
    body: b64url(createHash('sha256').update(cuerpo, 'utf8').digest()),
  }

  const partes = [
    b64url(Buffer.from(JSON.stringify(header), 'utf8')),
    b64url(Buffer.from(JSON.stringify(payload), 'utf8')),
  ]

  const firma = createHmac('sha256', signingKey).update(partes.join('.')).digest()

  return [...partes, b64url(firma)].join('.')
}
