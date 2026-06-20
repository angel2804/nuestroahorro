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
  const [usuario, setUsuario] = useState(null) // en memoria: al cerrar la app se cierra sesión

  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState(null)
  const [filtro, setFiltro] = useState('todos')
  const [ajustesAbierto, setAjustesAbierto] = useState(false)
  const [panelAbierto, setPanelAbierto] = useState(false)
  const [errorApp, setErrorApp] = useState('')
  const [exito, setExito] = useState(null) // { tipo, monto }
  const [noti, setNoti] = useState(null) // novedades del otro al entrar
  const backupHecho = useRef(false)
  const notiChecada = useRef(false)

  // Splash mínimo 2 segundos
  useEffect(() => {
    const t = setTimeout(() => setSplash(false), 2000)
    return () => clearTimeout(t)
  }, [])

  // Conexión Firebase + escucha en tiempo real
  useEffect(() => {
    let unsubMov, unsubPer
    listoFirebase.then(async () => {
      for (const p of PERSONAS) {
        const ref = doc(db, 'personas', p.id)
        const snap = await getDoc(ref)
        if (!snap.exists()) await setDoc(ref, { pin: p.pinDefecto, foto: '' })
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
    }).catch((e) => {
      setCargando(false)
      setErrorApp('No se pudo conectar a Firebase: ' + e.message +
        '. Revisa que el login Anónimo esté activado en Authentication.')
    })
    return () => { unsubMov?.(); unsubPer?.() }
  }, [])

  // Novedades: al entrar, avisa si el otro guardó/gastó mientras no estabas
  useEffect(() => {
    if (!usuario || cargando || notiChecada.current) return
    notiChecada.current = true
    const visto = Number(localStorage.getItem('na_visto_' + usuario) || 0)
    const nuevos = movimientos.filter(
      (m) => m.creadoPor && m.creadoPor !== usuario && (m.creado || 0) > visto
    )
    if (nuevos.length > 0) {
      const neto = nuevos.reduce((a, m) => a + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0)
      const otro = PERSONAS.find((p) => p.id !== usuario)
      setNoti({ nombre: otro.nombre, otroId: otro.id, cantidad: nuevos.length, neto })
    }
    localStorage.setItem('na_visto_' + usuario, String(Date.now()))
  }, [usuario, cargando, movimientos])

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
        await addDoc(collection(db, 'movimientos'), { ...resto, creadoPor: usuario, creado: Date.now() })
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

  function entrar(personaId) {
    setUsuario(personaId)
  }
  function salir() {
    setUsuario(null)
    notiChecada.current = false
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

      {/* Tarjeta principal */}
      <section className="total-card">
        <span className="total-label">Total juntos</span>
        <span className="total-monto"><Contador valor={total} /></span>
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
      {panelAbierto && (
        <PanelDev movimientos={movimientos} onCerrar={() => setPanelAbierto(false)} />
      )}
      {exito && <AnimacionExito tipo={exito.tipo} monto={exito.monto} />}
      {noti && (
        <NotificacionNovedad noti={noti} foto={perfiles[noti.otroId]?.foto} onCerrar={() => setNoti(null)} />
      )}
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
    <div className={`perfil perfil-${persona.id} ${foto ? 'con-foto' : ''}`}
      style={foto ? { backgroundImage: `url(${foto})` } : undefined}>
      <div className="perfil-overlay" />
      <div className="perfil-contenido">
        {puedeEditar && (
          <button className="perfil-cam" onClick={() => inputRef.current?.click()}>📷</button>
        )}
        <span className="perfil-nombre">{persona.nombre}</span>
        <span className={`perfil-saldo ${persona.id}`}>{soles(saldo)}</span>
      </div>
      <input ref={inputRef} type="file" accept="image/*" hidden
        onChange={(e) => e.target.files[0] && onSubirFoto(e.target.files[0])} />
    </div>
  )
}

/* ---------- Notificación de novedades ---------- */
function NotificacionNovedad({ noti, foto, onCerrar }) {
  const positivo = noti.neto >= 0
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className={`noti-card ${positivo ? 'pos' : 'neg'}`} onClick={(e) => e.stopPropagation()}>
        <div className={`noti-avatar avatar-${noti.otroId}`} style={foto ? { backgroundImage: `url(${foto})` } : undefined}>
          {!foto && noti.nombre[0]}
        </div>
        <div className="noti-campana">🔔</div>
        <h3 className="noti-titulo">¡Novedad!</h3>
        <p className="noti-texto">
          <b>{noti.nombre}</b> {noti.cantidad === 1 ? 'registró' : `hizo ${noti.cantidad} movimientos por`}{' '}
          <span className={positivo ? 'noti-monto-pos' : 'noti-monto-neg'}>
            {positivo ? '+' : '−'}{soles(Math.abs(noti.neto)).replace('S/ ', 'S/')}
          </span>{' '}
          mientras no estabas.
        </p>
        <button className="btn-primario" onClick={onCerrar}>¡Genial!</button>
      </div>
    </div>
  )
}

/* ---------- Modal movimiento ---------- */
function ModalMovimiento({ inicial, usuario, onGuardar, onCerrar }) {
  const [tipo, setTipo] = useState(inicial?.tipo || 'ingreso')
  const [monto, setMonto] = useState(inicial ? String(inicial.monto) : '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion || '')
  const [fecha, setFecha] = useState(
    inicial?.fecha ? inicial.fecha.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const [enviando, setEnviando] = useState(false)
  const persona = inicial?.persona || usuario

  async function submit(e) {
    e.preventDefault()
    if (enviando) return
    const valor = parseFloat(monto)
    if (!valor || valor <= 0) { alert('Ingresa un monto válido'); return }
    setEnviando(true)
    await onGuardar({
      id: inicial?.id,
      persona,
      tipo,
      monto: valor,
      descripcion: descripcion.trim(),
      fecha: new Date(fecha).toISOString(),
    })
    setEnviando(false)
  }

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>{inicial ? 'Editar movimiento' : 'Nuevo movimiento'}</h3>
        <div className="modal-persona">{PERSONAS.find((p) => p.id === persona)?.nombre}</div>

        <label>Tipo</label>
        <div className="segmento">
          <button type="button" className={tipo === 'ingreso' ? 'seg activo ingreso' : 'seg'} onClick={() => setTipo('ingreso')}>Ahorro (+)</button>
          <button type="button" className={tipo === 'gasto' ? 'seg activo gasto' : 'seg'} onClick={() => setTipo('gasto')}>Gasto (−)</button>
        </div>

        <label>Monto (S/)</label>
        <input type="number" inputMode="decimal" step="0.01" placeholder="0.00" value={monto} onChange={(e) => setMonto(e.target.value)} autoFocus />

        <label>Descripción (opcional)</label>
        <input type="text" placeholder="Ej: mercado, sueldo..." value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />

        <label>Fecha</label>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />

        <div className="modal-acciones">
          <button type="button" className="btn-secundario" onClick={onCerrar} disabled={enviando}>Cancelar</button>
          <button type="submit" className="btn-primario" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button>
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
