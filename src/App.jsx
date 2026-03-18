import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './App.css';

function App() {
  const [movimiento, setMovimiento] = useState({
    descripcion: '',
    monto: '',
    tipo: 'gasto',
    categoriaPago: 'efectivo', 
    cuenta: 'efectivo',
    esParaOtro: false,
    deudor: '',
    enCuotas: false,
    cuotaActual: '',
    cuotasTotales: ''
  });

  const [historial, setHistorial] = useState([]);
  const [mesFiltro, setMesFiltro] = useState('Todos');

  useEffect(() => {
    fetch('https://backend-finanzas-2kp0.onrender.com/api/movimientos')
      .then((respuesta) => respuesta.json())
      .then((datos) => setHistorial(datos))
      .catch((error) => console.error("Error conectando al servidor:", error));
  }, []);

  const manejarCambio = (evento) => {
    const { name, value, type, checked } = evento.target;
    const valor = type === 'checkbox' ? checked : value;

    if (name === 'categoriaPago') {
      let cuentaPorDefecto = value;
      if (value === 'tarjeta') cuentaPorDefecto = 'macro'; 
      setMovimiento({ ...movimiento, categoriaPago: value, cuenta: cuentaPorDefecto });
    } else {
      setMovimiento({ ...movimiento, [name]: valor });
    }
  };

  const guardarMovimiento = async (evento) => {
    evento.preventDefault(); 
    try {
      const cuotasTotales = movimiento.enCuotas ? parseInt(movimiento.cuotasTotales) : 1;
      const cuotaInicial = movimiento.enCuotas ? parseInt(movimiento.cuotaActual) : 1;

      // Si es en cuotas, dividimos el monto total por la cantidad de cuotas
      const montoMensual = movimiento.enCuotas
        ? parseFloat(movimiento.monto) / cuotasTotales
        : parseFloat(movimiento.monto);

      let promesasDeGuardado = [];
      let nuevosItemsParaHistorial = [];

      // Este es el motor que genera múltiples registros si hay cuotas
      for (let i = cuotaInicial; i <= cuotasTotales; i++) {
        
        // Calculamos la fecha saltando hacia los meses futuros
        let fechaCuota = new Date();
        fechaCuota.setMonth(fechaCuota.getMonth() + (i - cuotaInicial));

        const datosParaEnviar = {
          // Le agregamos " (Cuota 1/3)" al final del nombre automáticamente
          descripcion: movimiento.enCuotas ? `${movimiento.descripcion} (Cuota ${i}/${cuotasTotales})` : movimiento.descripcion,
          monto: montoMensual.toFixed(2), // Redondeamos a 2 decimales
          tipo: movimiento.tipo,
          cuenta: movimiento.cuenta,
          es_para_otro: movimiento.esParaOtro ? 1 : 0, 
          deudor: movimiento.deudor || null,
          en_cuotas: movimiento.enCuotas ? 1 : 0,
          cuota_actual: i,
          cuotas_totales: cuotasTotales,
          
          // Enviamos la fecha del futuro al backend
          fecha_movimiento: fechaCuota.toISOString().slice(0, 19).replace('T', ' ')
        };

        const peticion = fetch('//backend-finanzas-2kp0.onrender.com/api/movimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(datosParaEnviar)
        })
        .then(respuesta => {
          if (!respuesta.ok) throw new Error("Rechazado por el servidor");
          return respuesta.json();
        })
        .then(datosConfirmados => {
          nuevosItemsParaHistorial.push({ 
            ...movimiento, 
            descripcion: datosParaEnviar.descripcion,
            monto: datosParaEnviar.monto,
            cuotaActual: i,
            id: datosConfirmados.id, 
            fecha_creacion: fechaCuota.toISOString() 
          });
        });

        promesasDeGuardado.push(peticion);
      }

      // Esperamos a que TODOS los meses se hayan guardado en la base de datos
      await Promise.all(promesasDeGuardado);
      
      // Actualizamos la tabla ordenando desde el último generado
      setHistorial([...nuevosItemsParaHistorial.reverse(), ...historial]);
      
      // Limpiamos el formulario
      setMovimiento({
        descripcion: '', monto: '', tipo: 'gasto', categoriaPago: 'efectivo', cuenta: 'efectivo',
        esParaOtro: false, deudor: '', enCuotas: false, cuotaActual: '', cuotasTotales: ''
      });

    } catch (error) {
      console.error("Detalle del error:", error);
      alert("Hubo un error al guardar las cuotas. Revisa la terminal negra de tu backend.");
    }
  };

  const eliminarMovimiento = async (idAEliminar) => {
    // 1. Buscamos qué estamos intentando borrar
    const itemABorrar = historial.find((item) => item.id === idAEliminar);
    if (!itemABorrar) return;

    // 2. Detectamos si es una cuota buscando nuestra etiqueta especial
    const esCuota = itemABorrar.descripcion.includes(" (Cuota ");
    
    let idsABorrar = [idAEliminar];
    let mensajeConfirmacion = "¿Estás seguro de que quieres borrar este registro?";

    if (esCuota) {
      mensajeConfirmacion = "Este pago tiene cuotas. ¿Estás seguro de que quieres borrar TODAS las cuotas juntas al mismo tiempo?";
      
      // Separar el nombre base (Ej: "Zapatillas (Cuota 1/3)" -> "Zapatillas")
      const nombreBase = itemABorrar.descripcion.split(" (Cuota ")[0];

      // Encontrar a todas las hermanas con el mismo nombre y monto
      const cuotasRelacionadas = historial.filter(item => 
        item.descripcion && 
        item.descripcion.startsWith(nombreBase + " (Cuota ") &&
        item.monto === itemABorrar.monto 
      );

      // Juntamos los IDs de todas las hermanas
      idsABorrar = cuotasRelacionadas.map(item => item.id);
    }

    const confirmacion = window.confirm(mensajeConfirmacion);

    if (confirmacion) {
      try {
        // 3. Mandamos a borrar todos los IDs al servidor al mismo tiempo
        await Promise.all(
          idsABorrar.map(id =>
            fetch(`//backend-finanzas-2kp0.onrender.com/api/movimientos/${id}`, { method: 'DELETE' })
          )
        );

        // 4. Limpiamos nuestra pantalla quitando a todas las hermanas borradas
        const nuevoHistorial = historial.filter((item) => !idsABorrar.includes(item.id));
        setHistorial(nuevoHistorial);
      } catch (error) {
        console.error("Detalle del error:", error);
        alert("Error al intentar eliminar los registros. Revisa la terminal.");
      }
    }
  };

  const movimientosFiltrados = !Array.isArray(historial) ? [] : historial.filter((item) => {
    if (mesFiltro === 'Todos') return true;
    if (!item.fecha_creacion) return true; 
    const mesRegistro = new Date(item.fecha_creacion).getMonth() + 1;
    return mesRegistro.toString() === mesFiltro;
  });

  const calcularSaldo = () => {
    return movimientosFiltrados.reduce((total, item) => {
      const cantidad = parseFloat(item.monto) || 0; 
      return item.tipo === 'ingreso' ? total + cantidad : total - cantidad;
    }, 0);
  };

  const prepararDatosGrafico = () => {
    const gastos = movimientosFiltrados.filter((item) => item && item.tipo === 'gasto');
    const totalesPorCuenta = gastos.reduce((acumulador, item) => {
      const cuenta = (item.cuenta || 'OTRO').toUpperCase();
      const monto = parseFloat(item.monto) || 0;
      acumulador[cuenta] = (acumulador[cuenta] || 0) + monto;
      return acumulador;
    }, {});
    return Object.keys(totalesPorCuenta).map((cuenta) => ({ name: cuenta, value: totalesPorCuenta[cuenta] }));
  };

  const formatearFecha = (cadenaFecha) => {
    if (!cadenaFecha) return '-';
    return new Date(cadenaFecha).toLocaleDateString('es-AR');
  };

  const datosGrafico = prepararDatosGrafico();
  const COLORES = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];
  const saldoTotal = calcularSaldo();

  return (
    <div className="contenedor-principal">
      <div className="contenedor-finanzas">
        <h1>Mi Libro Diario 📓</h1>

        <div className="contenedor-filtro">
          <label>Ver movimientos de: </label>
          <select value={mesFiltro} onChange={(e) => setMesFiltro(e.target.value)} className="select-filtro">
            <option value="Todos">Todos los meses</option>
            <option value="1">Enero</option>
            <option value="2">Febrero</option>
            <option value="3">Marzo</option>
            <option value="4">Abril</option>
            <option value="5">Mayo</option>
            <option value="6">Junio</option>
            <option value="7">Julio</option>
            <option value="8">Agosto</option>
            <option value="9">Septiembre</option>
            <option value="10">Octubre</option>
            <option value="11">Noviembre</option>
            <option value="12">Diciembre</option>
          </select>
        </div>

        <div className={`tarjeta-saldo ${saldoTotal >= 0 ? 'saldo-positivo' : 'saldo-negativo'}`}>
          <p className="titulo-saldo">SALDO {mesFiltro === 'Todos' ? 'TOTAL' : 'DEL MES'}</p>
          <p className="monto-saldo">${saldoTotal.toFixed(2)}</p>
        </div>

        {datosGrafico.length > 0 && (
          <div className="contenedor-grafico">
            <h3>Distribución de Gastos</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={datosGrafico} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {datosGrafico.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORES[index % COLORES.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        <form onSubmit={guardarMovimiento} className="formulario">
          <div className="campo">
            <label>Descripción del movimiento:</label>
            <input type="text" name="descripcion" value={movimiento.descripcion} placeholder="Ej. Zapatillas, Supermercado..." onChange={manejarCambio} required />
          </div>

          <div className="campo">
            <label>Monto ($):</label>
            <input type="number" name="monto" value={movimiento.monto} placeholder="0.00" step="0.01" onChange={manejarCambio} required />
          </div>

          <div className="dos-columnas">
            <div className="campo">
              <label>Categoría de Pago:</label>
              <select name="categoriaPago" value={movimiento.categoriaPago} onChange={manejarCambio}>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjetas</option>
                <option value="prestamo">Préstamos</option>
              </select>
            </div>

            {movimiento.categoriaPago === 'tarjeta' && (
              <div className="campo">
                <label>¿Qué tarjeta?:</label>
                <select name="cuenta" value={movimiento.cuenta} onChange={manejarCambio}>
                  <option value="macro">Macro</option>
                  <option value="uala">Ualá</option>
                  <option value="naranja">Naranja</option>
                </select>
              </div>
            )}
            
            {movimiento.categoriaPago !== 'tarjeta' && (
              <div className="campo">
                <label>Tipo:</label>
                <select name="tipo" value={movimiento.tipo} onChange={manejarCambio}>
                  <option value="gasto">Gasto</option>
                  <option value="ingreso">Ingreso</option>
                </select>
              </div>
            )}
          </div>
          
          {movimiento.categoriaPago === 'tarjeta' && (
             <div className="campo">
               <label>Tipo:</label>
               <select name="tipo" value={movimiento.tipo} onChange={manejarCambio}>
                 <option value="gasto">Gasto</option>
                 <option value="ingreso">Ingreso</option>
               </select>
             </div>
          )}

          <div className="campo-checkbox">
            <label>
              <input type="checkbox" name="esParaOtro" checked={movimiento.esParaOtro} onChange={manejarCambio} />
              Este gasto es de otra persona
            </label>
          </div>

          {movimiento.esParaOtro && (
            <div className="campo">
              <label>¿A quién hay que cobrarle?</label>
              <input type="text" name="deudor" value={movimiento.deudor} placeholder="Escribe el nombre aquí..." onChange={manejarCambio} required />
            </div>
          )}

          <div className="campo-checkbox">
            <label>
              <input type="checkbox" name="enCuotas" checked={movimiento.enCuotas} onChange={manejarCambio} />
              Es un pago en cuotas
            </label>
          </div>

          {movimiento.enCuotas && (
            <div className="dos-columnas">
              <div className="campo">
                <label>Cuota actual (ej. 1):</label>
                <input type="number" name="cuotaActual" value={movimiento.cuotaActual} min="1" onChange={manejarCambio} required />
              </div>
              <div className="campo">
                <label>Total de cuotas (ej. 6):</label>
                <input type="number" name="cuotasTotales" value={movimiento.cuotasTotales} min="1" onChange={manejarCambio} required />
              </div>
            </div>
          )}

          <button type="submit" className="boton-guardar">Registrar Movimiento</button>
        </form>
      </div>

      {movimientosFiltrados.length > 0 && (
        <div className="contenedor-historial">
          <h2>Últimos Movimientos</h2>
          <div className="tabla-responsive">
            <table className="tabla-finanzas">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Descripción</th>
                  <th>Cuenta</th>
                  <th>Cuotas</th>
                  <th>Monto</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {movimientosFiltrados.map((item) => (
                  <tr key={item.id}>
                    <td className="texto-gris">{formatearFecha(item.fecha_creacion)}</td>
                    <td>{item.descripcion}</td>
                    <td className="mayuscula">{item.cuenta}</td>
                    <td>
                      {item.en_cuotas || item.enCuotas ? (
                        <span className="etiqueta-cuotas">{item.cuota_actual || item.cuotaActual} / {item.cuotas_totales || item.cuotasTotales}</span>
                      ) : (
                        <span className="texto-gris">-</span>
                      )}
                    </td>
                    <td className={item.tipo === 'ingreso' ? 'texto-verde' : ''}>
                      {item.tipo === 'ingreso' ? '+' : '-'}${item.monto}
                    </td>
                    <td>
                      {item.es_para_otro || item.esParaOtro ? (
                        <span className="etiqueta-deuda">Cobrar a {item.deudor}</span>
                      ) : (
                        <span className="etiqueta-ok">Propio</span>
                      )}
                    </td>
                    <td>
                      <button onClick={() => eliminarMovimiento(item.id)} className="boton-eliminar" title="Borrar registro">❌</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;