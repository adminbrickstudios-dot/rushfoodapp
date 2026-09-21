import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'

type Manejador = (req: Request) => Promise<Response>

export interface Rutas {
  [ruta: string]: Partial<Record<'GET' | 'POST', Manejador>>
}

export interface ServidorDePrueba {
  url: string
  cerrar(): Promise<void>
}

/**
 * Levanta un servidor HTTP de verdad que despacha a los route
 * handlers reales de Next.
 *
 * El objetivo es que los tests peguen por TCP con una firma calculada
 * a mano y recorran el camino completo: bytes crudos → verificación
 * de firma → base → respuesta. Nada de invocar la función de
 * verificación por separado, que es justamente lo que no prueba que
 * el conjunto ande.
 *
 * Lo que NO reproduce es el runtime de Next (after(), route segment
 * config); eso se cubre inyectando el contexto.
 */
export async function levantarServidor(rutas: Rutas): Promise<ServidorDePrueba> {
  const server: Server = createServer((req, res) => {
    void atender(rutas, req, res)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address() as AddressInfo
  const url = `http://127.0.0.1:${port}`

  return {
    url,
    cerrar: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}

async function atender(
  rutas: Rutas,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const chunks: Buffer[] = []
    for await (const trozo of req) chunks.push(trozo as Buffer)
    const cuerpo = Buffer.concat(chunks)

    const url = new URL(req.url ?? '/', `http://127.0.0.1`)
    const metodo = (req.method ?? 'GET').toUpperCase() as 'GET' | 'POST'

    const manejador = rutas[url.pathname]?.[metodo]
    if (!manejador) {
      res.writeHead(404).end('sin ruta')
      return
    }

    const cabeceras = new Headers()
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue
      for (const valor of Array.isArray(v) ? v : [v]) cabeceras.append(k, valor)
    }

    const peticion = new Request(url.toString(), {
      method: metodo,
      headers: cabeceras,
      body: metodo === 'GET' ? undefined : cuerpo,
    })

    const respuesta = await manejador(peticion)
    const salida = Buffer.from(await respuesta.arrayBuffer())

    const cabecerasSalida: Record<string, string> = {}
    respuesta.headers.forEach((valor, clave) => {
      cabecerasSalida[clave] = valor
    })

    res.writeHead(respuesta.status, cabecerasSalida).end(salida)
  } catch (err) {
    // Un throw acá sería un bug del andamiaje, no del código bajo
    // prueba: se distingue con un 599 para que el test no lo
    // confunda con un 500 legítimo del handler.
    res.writeHead(599).end(err instanceof Error ? err.message : String(err))
  }
}
