import { useState, useEffect, useMemo, useRef } from 'react'
import { db, listoFirebase } from './firebase'
import {
  collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, getDoc, getDocs,
} from 'firebase/firestore'

// Las dos personas de la app. PIN inicial por defecto.
const PERSONAS = [
  { id: 'hayllin', nombre: 'Hayllin', pinDefecto: '1111' },
  { id: 'angel', nombre: 'Angel', pinDefecto: '2222' },
]

// Categorías de movimiento (icono + si suma o resta)
const CATEGORIAS = [
  { id: 'ahorro', nombre: 'Ahorro', icono: '💰', tipo: 'ingreso' },
  { id: 'regalo', nombre: 'Regalo', icono: '🎁', tipo: 'ingreso' },
  { id: 'ingreso', nombre: 'Ingreso', icono: '💵', tipo: 'ingreso' },
  { id: 'deposito', nombre: 'Depósito', icono: '🏦', tipo: 'ingreso' },
  { id: 'retiro', nombre: 'Retiro', icono: '🛒', tipo: 'gasto' },
]
const CAT_MAP = Object.fromEntries(CATEGORIAS.map((c) => [c.id, c]))
const iconoMov = (m) => CAT_MAP[m.categoria]?.icono || (m.tipo === 'ingreso' ? '💰' : '🛒')

const soles = (n) =>
  'S/ ' + Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ---- Datos / backups ----
async function leerTodo() {
  const movs = (await getDocs(collection(db, 'movimientos'))).docs.map((d) => ({ id: d.id, ...d.data() }))
  const personas = {}
  ;(await getDocs(collection(db, 'personas'))).docs.forEach((d) => (personas[d.id] = d.data()))
  return { movimientos: movs, personas }
}
async function backupDiario() {
  const hoy = new Date().toISOString().slice(0, 10)
  const ref = doc(db, 'backups', hoy)
  const snap = await getDoc(ref)
  if (snap.exists()) return
  const datos = await leerTodo()
  await setDoc(ref, { fecha: new Date().toISOString(), ...datos })
}

export default function App() {
  const [cargando, setCargando] = useState(true)
  const [splash, setSplash] = useState(true)
  const [movimientos, setMovimientos] = useState([])
  const [perfiles, setPerfiles] = useState({})
  const [meta, setMeta] = useState({ nombre: 'Nuestra meta', objetivo: 1500 })
  const [usuario, setUsuario] = useState(() => sessionStorage.getItem('na_usuario') || null)

  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [ajustesAbierto, setAjustesAbierto] = useState(false)
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [metaAbierto, setMetaAbierto] = useState(false)
  const [errorApp, setErrorApp] = useState('')
  const [exito, setExito] = useState(null) // { tipo, monto }
  const backupHecho = useRef(false)

  // Splash mínimo 2 segundos
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 2000)
    return () => clearTimeout(t)
  }, [])

  // Conexión Firebase + escucha en tiempo real
  useEffect(() => {
    let unsubMov, unsubPer, unsubMeta
    listoFirebase.then(async () => {
      for (const p of PERSONAS) {
        const ref = doc(db, 'personas', p.id)
        const snap = await getDoc(ref)
        if (!snap.exists()) await setDoc(ref, { pin: p.pinDefecto, foto: '' })
      }
      const metaRef = doc(db, 'config', 'meta')
      if (!(await getDoc(metaRef)).exists()) {
        await setDoc(metaRef, { nombre: 'Nintendo Switch', objetivo: 1500 })
      }

      unsubMov = onSnapshot(
        collection(db, 'movimientos'),
        (snap) => {
          setMovimientos(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
          setCargando(false)
          if (!backupHecho.current) {
            backupHecho.current = true
            backupDiario().catch((e) => console.error('Error en backup diario:', e))
          }
        },
        (e) => setErrorApp('No se pudo leer la base de datos: ' + e.message)
      )
      unsubPer = onSnapshot(collection(db, 'personas'), (snap) => {
        const r = {}
        snap.docs.forEach((d) => (r[d.id] = d.data()))
        setPerfiles(r)
      })
      unsubMeta = onSnapshot(doc(db, 'config', 'meta'), (snap) => {
        if (snap.exists()) setMeta(snap.data())
      })
    }).catch((e) => {
      setCargando(false)
      setErrorApp('No se pudo conectar a Firebase: ' + e.message +
        '. Revisa que el login Anónimo esté activado en Authentication.')
    })
    return () => { unsubMov?.(); unsubPer?.(); unsubMeta?.() }
  }, [])

  const saldos = useMemo(() => {
    const r = {}
    for (const p of PERSONAS) r[p.id] = 0
    for (const m of movimientos) {
      if (r[m.persona] === undefined) continue
      r[m.persona] += m.tipo === 'ingreso' ? m.monto : -m.monto
    }
    return r
  }, [movimientos])

  const total = useMemo(() => Object.values(saldos).reduce((a, b) => a + b, 0), [saldos])

  // Cambio neto de los últimos 7 días
  const estaSemana = useMemo(() => {
    const hace7 = Date.now() - 7 * 24 * 60 * 60 * 1000
    return movimientos.reduce((acc, m) => {
      if (new Date(m.fecha).getTime() < hace7) return acc
      return acc + (m.tipo === 'ingreso' ? m.monto : -m.monto)
    }, 0)
  }, [movimientos])

  const movimientosFiltrados = useMemo(() => {
    const lista = filtro === 'todos' ? movimientos : movimientos.filter((m) => m.persona === filtro)
    return [...lista].sort((a, b) => b.fecha.localeCompare(a.fecha))
  }, [movimientos, filtro])

  async function guardarMovimiento(mov) {
    try {
      const { id, ...resto } = mov
      if (id) {
        await updateDoc(doc(db, 'movimientos', id), resto)
      } else {
        await addDoc(collection(db, 'movimientos'), { ...resto, creadoPor: usuario })
      }
      setModalAbierto(false)
      setEditando(null)
      if (!id) {
        setExito({ tipo: resto.tipo, monto: resto.monto })
        setTimeout(() => setExito(null), 1600)
      }
    } catch (e) {
      alert('No se pudo guardar: ' + e.message +
        '\n\nRevisa las reglas de Firestore y que el login Anónimo esté activado.')
    }
  }

  async function borrarMovimiento(id) {
    if (confirm('¿Borrar este movimiento?')) await deleteDoc(doc(db, 'movimientos', id))
  }

  function subirFoto(personaId, file) {
    const reader = new FileReader()
    reader.onload = () => updateDoc(doc(db, 'personas', personaId), { foto: reader.result })
    reader.readAsDataURL(file)
  }

  async function cambiarPin(nuevoPin) {
    await updateDoc(doc(db, 'personas', usuario), { pin: nuevoPin })
    setAjustesAbierto(false)
  }

  async function guardarMeta(datos) {
    await setDoc(doc(db, 'config', 'meta'), datos)
    setMetaAbierto(false)
  }

  function entrar(personaId) {
    setUsuario(personaId)
    sessionStorage.setItem('na_usuario', personaId)
  }
  function salir() {
    setUsuario(null)
    sessionStorage.removeItem('na_usuario')
  }

  if (splash || cargando) return <Splash />
  if (!usuario) return <Login perfiles={perfiles} onEntrar={entrar} />

  const yo = PERSONAS.find((p) => p.id === usuario)

  return (
    <div className={`app tema-${usuario}`}>
      <div className="fondo-luces" />

      {errorApp && (
        <div className="banner-error" onClick={() => setErrorApp('')}>
          ⚠️ {errorApp} <span className="banner-x">(tocar para cerrar)</span>
        </div>
      )}

      <header className="cabecera">
        <div className="cab-fila">
          <div>
            <h1 className="titulo-app">Nuestros<span>Ahorros</span></h1>
            <p className="sub">Hola, {yo?.nombre} 👋</p>
          </div>
          <div className="cab-botones">
            {usuario === 'angel' && (
              <button className="icono-btn" onClick={() => setPanelAbierto(true)} title="Panel Dev">🛠️</button>
            )}
            <button className="icono-btn" onClick={() => setAjustesAbierto(true)} title="Cambiar PIN">⚙️</button>
            <button className="icono-btn" onClick={salir} title="Salir">🚪</button>
          </div>
        </div>
      </header>

      {/* Tarjeta principal - glassmorphism */}
      <section className="total-glass">
        <span className="total-label">💰 Total Ahorrado</span>
        <span className="total-monto"><Contador valor={total} /></span>
        <span className={`total-semana ${estaSemana >= 0 ? 'pos' : 'neg'}`}>
          {estaSemana >= 0 ? '+' : '−'}{soles(Math.abs(estaSemana)).replace('S/ ', 'S/')} esta semana
        </span>
      </section>

      {/* Participación */}
      <section className="participacion">
        <h2 className="seccion-titulo">Participación</h2>
        {PERSONAS.map((p) => {
          const pct = total > 0 ? Math.round((Math.max(saldos[p.id], 0) / total) * 100) : 0
          return (
            <div className="part-fila" key={p.id}>
              <div className="part-top">
                <span>{p.nombre}</span>
                <span className="part-pct">{pct}%</span>
              </div>
              <div className="part-barra">
                <div className={`part-relleno ${p.id}`} style={{ width: pct + '%' }} />
              </div>
            </div>
          )
        })}
      </section>

      {/* Perfiles de integrantes */}
      <section className="perfiles">
        {PERSONAS.map((p) => (
          <PerfilPersona
            key={p.id}
            persona={p}
            saldo={saldos[p.id]}
            foto={perfiles[p.id]?.foto}
            puedeEditar={p.id === usuario}
            onSubirFoto={(file) => subirFoto(p.id, file)}
          />
        ))}
      </section>

      {/* Meta */}
      <MetaCard meta={meta} total={total} onEditar={() => setMetaAbierto(true)} />

      {/* Movimientos */}
      <section className="historial">
        <div className="historial-head">
          <h2 className="seccion-titulo">Movimientos</h2>
          <div className="filtros">
            <button className={filtro === 'todos' ? 'chip activo' : 'chip'} onClick={() => setFiltro('todos')}>Todos</button>
            {PERSONAS.map((p) => (
              <button key={p.id} className={filtro === p.id ? 'chip activo' : 'chip'} onClick={() => setFiltro(p.id)}>
                {p.nombre}
              </button>
            ))}
          </div>
        </div>

        {movimientosFiltrados.length === 0 ? (
          <p className="vacio">Aún no hay movimientos. Toca el botón + para agregar uno.</p>
        ) : (
          <ul className="lista">
            {movimientosFiltrados.map((m) => {
              const persona = PERSONAS.find((p) => p.id === m.persona)
              return (
                <li key={m.id} className="item">
                  <div className={`item-icono ${m.tipo}`}>{iconoMov(m)}</div>
                  <div className="item-info">
                    <span className="item-desc">{m.descripcion || CAT_MAP[m.categoria]?.nombre || (m.tipo === 'ingreso' ? 'Ahorro' : 'Retiro')}</span>
                    <span className="item-meta">{persona?.nombre} · {new Date(m.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <div className="item-derecha">
                    <span className={`item-monto ${m.tipo}`}>{m.tipo === 'ingreso' ? '+' : '−'}{soles(m.monto).replace('S/ ', 'S/')}</span>
                    {m.persona === usuario && (
                      <div className="item-acciones">
                        <button className="btn-mini" onClick={() => { setEditando(m); setModalAbierto(true) }}>Editar</button>
                        <button className="btn-mini borrar" onClick={() => borrarMovimiento(m.id)}>Borrar</button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <button className="fab" onClick={() => { setEditando(null); setModalAbierto(true) }}>+</button>

      {modalAbierto && (
        <ModalMovimiento inicial={editando} usuario={usuario}
          onGuardar={guardarMovimiento}
          onCerrar={() => { setModalAbierto(false); setEditando(null) }} />
      )}
      {ajustesAbierto && (
        <ModalPin nombre={yo?.nombre} onGuardar={cambiarPin} onCerrar={() => setAjustesAbierto(false)} />
      )}
      {metaAbierto && (
        <ModalMeta meta={meta} onGuardar={guardarMeta} onCerrar={() => setMetaAbierto(false)} />
      )}
      {panelAbierto && (
        <PanelDev movimientos={movimientos} onCerrar={() => setPanelAbierto(false)} />
      )}
      {exito && <AnimacionExito tipo={exito.tipo} monto={exito.monto} />}
    </div>
  )
}

/* ---------- Contador animado ---------- */
function Contador({ valor }) {
  const [mostrado, setMostrado] = useState(valor)
  const ref = useRef(valor)
  useEffect(() => {
    const inicio = ref.current, fin = valor, dur = 900, t0 = performance.now()
    let raf
    const tick = (t) => {
      const p = Math.min((t - t0) / dur, 1)
      const e = 1 - Math.pow(1 - p, 3)
      setMostrado(inicio + (fin - inicio) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else ref.current = fin
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [valor])
  return <>{soles(mostrado)}</>
}

/* ---------- Splash ---------- */
function Splash() {
  return (
    <div className="splash">
      <div className="splash-particulas">
        {Array.from({ length: 14 }).map((_, i) => <span key={i} style={{ '--i': i }} />)}
      </div>
      <div className="splash-logo"><span>S/</span></div>
      <h1 className="splash-nombre">Nuestros Ahorros</h1>
    </div>
  )
}

/* ---------- Login ---------- */
function Login({ perfiles, onEntrar }) {
  const [seleccion, setSeleccion] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')

  function intentar(e) {
    e.preventDefault()
    const correcto = perfiles[seleccion]?.pin || PERSONAS.find((p) => p.id === seleccion)?.pinDefecto
    if (pin === correcto) onEntrar(seleccion)
    else { setError('PIN incorrecto'); setPin('') }
  }

  if (!seleccion) {
    return (
      <div className="login">
        <div className="fondo-luces" />
        <div className="splash-logo chico"><span>S/</span></div>
        <h1 className="titulo-app grande">Nuestros<span>Ahorros</span></h1>
        <p className="sub">¿Quién entra?</p>
        <div className="login-personas">
          {PERSONAS.map((p) => (
            <button key={p.id} className="login-persona" onClick={() => setSeleccion(p.id)}>
              <div className={`login-avatar avatar-${p.id}`} style={perfiles[p.id]?.foto ? { backgroundImage: `url(${perfiles[p.id].foto})` } : undefined}>
                {!perfiles[p.id]?.foto && p.nombre[0]}
              </div>
              <span>{p.nombre}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const persona = PERSONAS.find((p) => p.id === seleccion)
  return (
    <form className={`login tema-${seleccion}`} onSubmit={intentar}>
      <div className="fondo-luces" />
      <div className={`login-avatar grande avatar-${seleccion}`} style={perfiles[seleccion]?.foto ? { backgroundImage: `url(${perfiles[seleccion].foto})` } : undefined}>
        {!perfiles[seleccion]?.foto && persona.nombre[0]}
      </div>
      <h1>Hola, {persona.nombre}</h1>
      <p className="sub">Ingresa tu PIN</p>
      <input className="pin-input" type="password" inputMode="numeric" maxLength={8} value={pin} autoFocus
        onChange={(e) => { setPin(e.target.value); setError('') }} placeholder="••••" />
      {error && <span className="error">{error}</span>}
      <button type="submit" className="btn-primario">Entrar</button>
      <button type="button" className="btn-texto" onClick={() => { setSeleccion(null); setPin(''); setError('') }}>← Volver</button>
    </form>
  )
}

/* ---------- Perfil de persona ---------- */
function PerfilPersona({ persona, saldo, foto, puedeEditar, onSubirFoto }) {
  const inputRef = useRef(null)
  return (
    <div className={`perfil perfil-${persona.id}`}>
      <button className={`perfil-avatar avatar-${persona.id}`} onClick={() => puedeEditar && inputRef.current?.click()}
        style={foto ? { backgroundImage: `url(${foto})` } : undefined}>
        {!foto && persona.nombre[0]}
        {puedeEditar && <span className="perfil-cam">📷</span>}
      </button>
      <span className="perfil-nombre">{persona.nombre}</span>
      <span className={`perfil-saldo ${persona.id}`}>{soles(saldo)}</span>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={(e) => e.target.files[0] && onSubirFoto(e.target.files[0])} />
    </div>
  )
}

/* ---------- Meta ---------- */
function MetaCard({ meta, total, onEditar }) {
  const pct = meta.objetivo > 0 ? Math.min(Math.round((total / meta.objetivo) * 100), 100) : 0
  return (
    <section className="meta-card" onClick={onEditar}>
      <div className="meta-head">
        <span className="meta-titulo">🎯 Meta Familiar</span>
        <span className="meta-editar">editar</span>
      </div>
      <span className="meta-nombre">{meta.nombre}</span>
      <div className="meta-barra"><div className="meta-relleno" style={{ width: pct + '%' }} /></div>
      <div className="meta-pie">
        <span>{soles(total)} de {soles(meta.objetivo)}</span>
        <span className="meta-pct">{pct}%</span>
      </div>
    </section>
  )
}

/* ---------- Modal movimiento ---------- */
function ModalMovimiento({ inicial, usuario, onGuardar, onCerrar }) {
  const [categoria, setCategoria] = useState(
    inicial?.categoria || (inicial?.tipo === 'gasto' ? 'retiro' : 'ahorro')
  )
  const [monto, setMonto] = useState(inicial ? String(inicial.monto) : '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion || '')
  const [fecha, setFecha] = useState(
    inicial?.fecha ? inicial.fecha.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const persona = inicial?.persona || usuario

  function submit(e) {
    e.preventDefault()
    const valor = parseFloat(monto)
    if (!valor || valor <= 0) { alert('Ingresa un monto válido'); return }
    onGuardar({
      id: inicial?.id,
      persona,
      categoria,
      tipo: CAT_MAP[categoria].tipo,
      monto: valor,
      descripcion: descripcion.trim(),
      fecha: new Date(fecha).toISOString(),
    })
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{inicial ? 'Editar movimiento' : 'Nuevo movimiento'}</h3>
        <div className="modal-persona">{PERSONAS.find((p) => p.id === persona)?.nombre}</div>

        <label>Tipo</label>
        <div className="cat-grid">
          {CATEGORIAS.map((c) => (
            <button type="button" key={c.id}
              className={`cat-btn ${categoria === c.id ? 'activo ' + c.tipo : ''}`}
              onClick={() => setCategoria(c.id)}>
              <span className="cat-ico">{c.icono}</span>
              <span>{c.nombre}</span>
            </button>
          ))}
        </div>

        <label>Monto (S/)</label>
        <input type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />

        <label>Descripción (opcional)</label>
        <input type="text" placeholder="Ej: mercado, sueldo..." value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />

        <label>Fecha</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />

        <div className="modal-acciones">
          <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  )
}

/* ---------- Modal PIN ---------- */
function ModalPin({ nombre, onGuardar, onCerrar }) {
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  function submit(e) {
    e.preventDefault()
    if (pin1.length < 4) { setError('El PIN debe tener al menos 4 dígitos'); return }
    if (pin1 !== pin2) { setError('Los PIN no coinciden'); return }
    onGuardar(pin1)
  }
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Cambiar PIN de {nombre}</h3>
        <label>Nuevo PIN</label>
        <input type="password" inputMode="numeric" maxLength={8} value={pin1} onChange={(e) => { setPin1(e.target.value); setError('') }} autoFocus />
        <label>Repetir PIN</label>
        <input type="password" inputMode="numeric" maxLength={8} value={pin2} onChange={(e) => { setPin2(e.target.value); setError('') }} />
        {error && <span className="error">{error}</span>}
        <div className="modal-acciones">
          <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  )
}

/* ---------- Modal Meta ---------- */
function ModalMeta({ meta, onGuardar, onCerrar }) {
  const [nombre, setNombre] = useState(meta.nombre)
  const [objetivo, setObjetivo] = useState(String(meta.objetivo))
  function submit(e) {
    e.preventDefault()
    const obj = parseFloat(objetivo)
    if (!obj || obj <= 0) { alert('Ingresa un objetivo válido'); return }
    onGuardar({ nombre: nombre.trim() || 'Nuestra meta', objetivo: obj })
  }
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>🎯 Meta Familiar</h3>
        <label>¿Qué quieren lograr?</label>
        <input type="text" placeholder="Ej: Nintendo Switch, viaje..." value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
        <label>Monto objetivo (S/)</label>
        <input type="number" inputMode="decimal" step="0.01" value={objetivo} onChange={(e) => setObjetivo(e.target.value)} />
        <div className="modal-acciones">
          <button type="button" className="btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button type="submit" className="btn-primario">Guardar</button>
        </div>
      </form>
    </div>
  )
}

/* ---------- Animación de éxito ---------- */
function AnimacionExito({ tipo, monto }) {
  return (
    <div className="exito-fondo">
      <div className={`exito-circulo ${tipo}`}>
        <svg viewBox="0 0 52 52" className="exito-check">
          <path d="M14 27 l8 8 l16 -16" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="exito-texto">{tipo === 'ingreso' ? '+' : '−'}{soles(monto).replace('S/ ', 'S/')}</span>
    </div>
  )
}

/* ---------- Panel Dev ---------- */
function PanelDev({ movimientos, onCerrar }) {
  const [backups, setBackups] = useState([])
  const [estado, setEstado] = useState('')
  const [cargandoLista, setCargandoLista] = useState(true)

  async function cargarBackups() {
    setCargandoLista(true)
    const snap = await getDocs(collection(db, 'backups'))
    setBackups(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id)))
    setCargandoLista(false)
  }
  useEffect(() => { cargarBackups() }, [])

  async function crearBackupAhora() {
    setEstado('Creando backup…')
    const hoy = new Date().toISOString().slice(0, 10)
    const datos = await leerTodo()
    await setDoc(doc(db, 'backups', hoy), { fecha: new Date().toISOString(), ...datos })
    setEstado('✅ Backup de hoy guardado')
    cargarBackups()
  }
  async function descargarTodo() {
    const datos = await leerTodo()
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ahorros-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  async function restaurar(backup) {
    if (!confirm(`¿Restaurar el backup del ${backup.id}? Esto reemplazará TODOS los movimientos actuales.`)) return
    setEstado('Restaurando…')
    const actuales = await getDocs(collection(db, 'movimientos'))
    await Promise.all(actuales.docs.map((d) => deleteDoc(doc(db, 'movimientos', d.id))))
    await Promise.all((backup.movimientos || []).map(({ id, ...m }) => setDoc(doc(db, 'movimientos', id), m)))
    for (const [pid, datos] of Object.entries(backup.personas || {})) await setDoc(doc(db, 'personas', pid), datos)
    setEstado(`✅ Restaurado el backup del ${backup.id}`)
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal panel" onClick={(e) => e.stopPropagation()}>
        <h3>🛠️ Panel Dev — Angel</h3>
        <p className="panel-info">Movimientos actuales: <b>{movimientos.length}</b><br />Backup automático: <b>1 vez al día</b>.</p>
        <div className="panel-acciones">
          <button className="btn-primario" onClick={crearBackupAhora}>Crear backup ahora</button>
          <button className="btn-secundario" onClick={descargarTodo}>Descargar todo (.json)</button>
        </div>
        {estado && <p className="panel-estado">{estado}</p>}
        <h4 className="panel-titulo">Backups en la nube</h4>
        {cargandoLista ? <p className="panel-info">Cargando…</p> : backups.length === 0 ? (
          <p className="panel-info">Aún no hay backups.</p>
        ) : (
          <ul className="panel-lista">
            {backups.map((b) => (
              <li key={b.id}>
                <div><span className="bk-fecha">{b.id}</span><span className="bk-meta">{(b.movimientos || []).length} movimientos</span></div>
                <button className="btn-restaurar" onClick={() => restaurar(b)}>Restaurar</button>
              </li>
            ))}
          </ul>
        )}
        <button className="btn-secundario" style={{ marginTop: 16 }} onClick={onCerrar}>Cerrar</button>
      </div>
    </div>
  )
}
