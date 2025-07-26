// PRO-REQUEST v2 - Sistema de Gestión de Transporte
// ===============================
// Configuración Firebase
const firebaseConfig = {
    apiKey: "",
    // ⚠️ Corrige estos dos valores con los reales de tu proyecto si aún no lo hiciste:
    authDomain: "pro-request.firebaseapp.com",
    databaseURL: "https://pro-request-default-rtdb.firebaseio.com",
    projectId: "pro-request",
    storageBucket: "pro-request.appspot.com",
    messagingSenderId: "",
    appId: ""
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ===============================
// Variables globales
let currentUser = null;
let userRole = null;
let map = null;
let markers = {};
let gpsInterval = null;

// Agregar después de las variables globales existentes
let rutasActivas = {}; // Para almacenar las rutas dibujadas
let destinosCoords = {}; // Coordenadas de destinos frecuentes
let viajesActivosPorUsuario = {}; // Viajes activos de cada usuario

// Capacidades de vehículos (v2)
let VEHICLE_CAPACITIES = {
    'camioneta': 4,
    'van': 8,
    'bus': 15
};

// ===============================
// Utils

// **NUEVO**: Formatear hora a 12h (robusta)
function formatearHora12(hora24) {
    if (!hora24 || typeof hora24 !== 'string' || !hora24.includes(':')) return hora24 || '';
    const [h, m] = hora24.split(':');
    const hora = parseInt(h, 10);
    const periodo = hora >= 12 ? 'PM' : 'AM';
    const hora12 = hora > 12 ? hora - 12 : (hora === 0 ? 12 : hora);
    return `${hora12}:${m.padStart(2, '0')} ${periodo}`;
}

// ===============================
// Inicialización
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 PRO-REQUEST v2 Iniciando...');
	
	// Verificar si existe el formulario antes de agregar listener
    const asignarForm = document.getElementById('asignarVehiculoForm');
    if (asignarForm) {
        asignarForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const choferId = document.getElementById('choferParaVehiculo').value;
            const vehiculoId = document.getElementById('vehiculoParaChofer').value;
        
            if (choferId && vehiculoId) {
                await asignarVehiculoAChofer(choferId, vehiculoId);
                cargarChoferesSinVehiculo();
                cargarVehiculosSinChofer();
                cargarListaVehiculos();
            }
        });
    }
    
    // Configurar listeners de formularios
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('solicitarViajeForm').addEventListener('submit', handleSolicitarViaje);
    document.getElementById('registrarUsuarioForm').addEventListener('submit', handleRegistrarUsuario);
    document.getElementById('configurarCapacidadForm').addEventListener('submit', handleConfigurarCapacidad);
    document.getElementById('exportarForm').addEventListener('submit', handleExportar);
    
    // Listener para cambio de destino
    document.getElementById('destinoSolicitud').addEventListener('change', function() {
        const otroDestino = document.getElementById('otroDestino');
        if (this.value === 'otro') {
            otroDestino.style.display = 'block';
            otroDestino.required = true;
        } else {
            otroDestino.style.display = 'none';
            otroDestino.required = false;
        }
    });
    
    // Listener para cambio de chofer asignado
    document.getElementById('choferAsignado').addEventListener('change', function() {
        if (this.value) {
            document.getElementById('idEmpleadoSolicitud').value = this.value;
        }
    });
    
    // Listener para verificar ID duplicado
    document.getElementById('nuevoUserId').addEventListener('blur', async function() {
        const userId = this.value;
        if (userId) {
            const exists = await verificarIdExistente(userId);
            if (exists) {
                this.classList.add('is-invalid');
            } else {
                this.classList.remove('is-invalid');
            }
        }
    });
    
    // Listener para verificar contraseñas coincidentes
    document.getElementById('nuevoUserPasswordConfirm').addEventListener('input', function() {
        const pass1 = document.getElementById('nuevoUserPassword').value;
        const pass2 = this.value;
        
        if (pass2 && pass1 !== pass2) {
            this.classList.add('is-invalid');
        } else {
            this.classList.remove('is-invalid');
        }
    });
    
    // Listener para tipo de usuario en registro
    document.getElementById('nuevoUserTipo').addEventListener('change', function() {
        const departamentoField = document.getElementById('departamentoField');
        const licenciaField = document.getElementById('licenciaField');
        
        if (this.value === 'chofer') {
            departamentoField.style.display = 'none';
            licenciaField.style.display = 'block';
        } else {
            departamentoField.style.display = 'block';
            licenciaField.style.display = 'none';
        }
    });
    
    // Cargar horarios disponibles (v2: 6AM - 10PM cada 30 min)
    cargarHorariosDisponibles();
    
    // Cargar capacidades desde Firebase
    cargarCapacidades();
	cargarDestinosCoords();
    
    // Simular carga
    setTimeout(() => {
        document.getElementById('loadingScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
    }, 1500);
});

// ===============================
// Cargar horarios disponibles (v2)
function cargarHorariosDisponibles() {
    const select = document.getElementById('horaSolicitud');
    
    db.ref('configuracion/horarios_disponibles').once('value', (snapshot) => {
        const horarios = snapshot.val();
        
        if (horarios) {
            horarios.forEach(horario => {
                const option = document.createElement('option');
                option.value = horario.value;
                option.textContent = horario.display;
                select.appendChild(option);
            });
        } else {
            // Generar horarios por defecto si no existen
            for (let h = 6; h <= 22; h++) {
                for (let m = 0; m < 60; m += 30) {
                    const hora24 = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                    const hora12 = formatearHora12(hora24);
                    const option = document.createElement('option');
                    option.value = hora24;
                    option.textContent = hora12;
                    select.appendChild(option);
                }
            }
        }
    });
}

// ===============================
// Verificar ID existente
async function verificarIdExistente(userId) {
    try {
        const userSnapshot = await db.ref(`usuarios/${userId}`).once('value');
        return userSnapshot.exists();
    } catch (error) {
        console.error('Error verificando ID:', error);
        return false;
    }
}

// ===============================
// Obtener choferes disponibles
async function obtenerChoferesDisponibles() {
    try {
        // Obtener todos los choferes
        const choferesSnap = await db.ref('usuarios')
            .orderByChild('rol')
            .equalTo('chofer')
            .once('value');
        
        const choferes = choferesSnap.val() || {};
        
        // Obtener viajes activos
        const viajesSnap = await db.ref('viajes_disponibles')
            .orderByChild('estado')
            .equalTo('programado')
            .once('value');
        
        const viajesActivos = viajesSnap.val() || {};
        
        // Filtrar choferes ocupados
        const choferesOcupados = new Set();
        Object.values(viajesActivos).forEach(viaje => {
            if (viaje.chofer_id) {
                choferesOcupados.add(viaje.chofer_id);
            }
        });
        
        // Retornar solo choferes disponibles
        const choferesDisponibles = {};
        Object.entries(choferes).forEach(([id, chofer]) => {
            if (chofer.activo && !choferesOcupados.has(id)) {
                choferesDisponibles[id] = chofer;
            }
        });
        
        return choferesDisponibles;
    } catch (error) {
        console.error('Error obteniendo choferes disponibles:', error);
        return {};
    }
}

// ===============================
// Cargar capacidades desde Firebase
function cargarCapacidades() {
    db.ref('configuracion/capacidades_vehiculos').once('value', (snapshot) => {
        const capacidades = snapshot.val();
        if (capacidades) {
            VEHICLE_CAPACITIES = capacidades;
        }
    });
}

// Agregar después de cargarCapacidades()
async function cargarDestinosCoords() {
    try {
        const destinosSnap = await db.ref('destinos_frecuentes').once('value');
        const destinos = destinosSnap.val() || {};
        
        destinosCoords = {};
        Object.entries(destinos).forEach(([id, destino]) => {
            destinosCoords[destino.nombre] = {
                lat: destino.lat,
                lng: destino.lng,
                tiempo_estimado: destino.tiempo_estimado
            };
        });
        
        // Agregar coordenadas de la empresa
        destinosCoords['Empresa'] = {
            lat: 18.4861,
            lng: -69.9312,
            tiempo_estimado: '0 min'
        };
        
        console.log('Destinos cargados:', destinosCoords);
    } catch (error) {
        console.error('Error cargando destinos:', error);
    }
}

// Agregar esta nueva función completa
async function dibujarRutaEnMapa(vehiculoId, origen, destinoNombre, tipo = 'simple') {
    // Limpiar ruta anterior si existe
    if (rutasActivas[vehiculoId]) {
        map.removeLayer(rutasActivas[vehiculoId].polyline);
        if (rutasActivas[vehiculoId].markers) {
            rutasActivas[vehiculoId].markers.forEach(m => map.removeLayer(m));
        }
    }
    
    // Obtener coordenadas del destino
    const destino = destinosCoords[destinoNombre];
    if (!destino) {
        console.error('Destino no encontrado:', destinoNombre);
        return;
    }
    
    if (tipo === 'simple') {
        // Ruta simple (línea directa)
        dibujarRutaSimple(vehiculoId, origen, destino, destinoNombre);
    } else {
        // Ruta real con API
        await dibujarRutaReal(vehiculoId, origen, destino, destinoNombre);
    }
}

// Función para ruta simple
function dibujarRutaSimple(vehiculoId, origen, destino, destinoNombre) {
    // Crear polyline
    const polyline = L.polyline([
        [origen.lat, origen.lng],
        [destino.lat, destino.lng]
    ], {
        color: '#007bff',
        weight: 5,
        opacity: 0.7,
        dashArray: '10, 10' // Línea punteada para indicar que es aproximada
    }).addTo(map);
    
    // Marcador de destino
    const destinoMarker = L.marker([destino.lat, destino.lng], {
        icon: L.divIcon({
            html: '<i class="fas fa-flag-checkered fa-2x" style="color: #dc3545;"></i>',
            iconSize: [30, 30],
            className: 'destination-icon'
        })
    }).addTo(map)
    .bindPopup(`<strong>Destino:</strong> ${destinoNombre}<br>
                <strong>Tiempo estimado:</strong> ${destino.tiempo_estimado}`);
    
    // Marcador de origen (empresa)
    const origenMarker = L.marker([origen.lat, origen.lng], {
        icon: L.divIcon({
            html: '<i class="fas fa-building fa-2x" style="color: #28a745;"></i>',
            iconSize: [30, 30],
            className: 'origin-icon'
        })
    }).addTo(map)
    .bindPopup('<strong>Origen:</strong> PRO-REQUEST<br>Sede Principal');
    
    // Calcular distancia
    const distancia = calcularDistancia(origen.lat, origen.lng, destino.lat, destino.lng);
    
    // Guardar referencia
    rutasActivas[vehiculoId] = {
        polyline: polyline,
        markers: [destinoMarker, origenMarker],
        distancia: distancia,
        tipo: 'simple'
    };
    
    // Ajustar vista para mostrar toda la ruta
    const bounds = polyline.getBounds();
    map.fitBounds(bounds, { padding: [50, 50] });
}

// Función para ruta real con OpenRouteService (GRATIS)
async function dibujarRutaReal(vehiculoId, origen, destino, destinoNombre) {
    // API Key gratuita de OpenRouteService (registrarse en openrouteservice.org)
    const API_KEY = '6Im11cm11cjY0In0='; // Reemplazar con tu API key
    
    try {
        const url = `https://api.openrouteservice.org/v2/directions/driving-car?api_key=${API_KEY}&start=${origen.lng},${origen.lat}&end=${destino.lng},${destino.lat}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            console.error('Error obteniendo ruta, usando ruta simple');
            dibujarRutaSimple(vehiculoId, origen, destino, destinoNombre);
            return;
        }
        
        const data = await response.json();
        const coordinates = data.features[0].geometry.coordinates;
        const properties = data.features[0].properties;
        
        // Convertir coordenadas
        const latLngs = coordinates.map(coord => [coord[1], coord[0]]);
        
        // Crear polyline con la ruta real
        const polyline = L.polyline(latLngs, {
            color: '#007bff',
            weight: 6,
            opacity: 0.8
        }).addTo(map);
        
        // Marcadores
        const destinoMarker = L.marker([destino.lat, destino.lng], {
            icon: L.divIcon({
                html: '<i class="fas fa-flag-checkered fa-2x" style="color: #dc3545;"></i>',
                iconSize: [30, 30],
                className: 'destination-icon'
            })
        }).addTo(map)
        .bindPopup(`<strong>Destino:</strong> ${destinoNombre}<br>
                    <strong>Distancia:</strong> ${(properties.segments[0].distance / 1000).toFixed(1)} km<br>
                    <strong>Tiempo estimado:</strong> ${Math.round(properties.segments[0].duration / 60)} min`);
        
        const origenMarker = L.marker([origen.lat, origen.lng], {
            icon: L.divIcon({
                html: '<i class="fas fa-building fa-2x" style="color: #28a745;"></i>',
                iconSize: [30, 30],
                className: 'origin-icon'
            })
        }).addTo(map)
        .bindPopup('<strong>Origen:</strong> PRO-REQUEST<br>Sede Principal');
        
        // Guardar referencia
        rutasActivas[vehiculoId] = {
            polyline: polyline,
            markers: [destinoMarker, origenMarker],
            distancia: properties.segments[0].distance / 1000,
            duracion: properties.segments[0].duration / 60,
            tipo: 'real'
        };
        
        // Ajustar vista
        map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
        
        // Mostrar información de la ruta
        mostrarInfoRuta(vehiculoId, destinoNombre, properties.segments[0]);
        
    } catch (error) {
        console.error('Error con API de rutas:', error);
        // Fallback a ruta simple
        dibujarRutaSimple(vehiculoId, origen, destino, destinoNombre);
    }
}

// Función para mostrar información de la ruta
function mostrarInfoRuta(vehiculoId, destinoNombre, segmento) {
    const infoPanel = document.getElementById('vehicleInfoPanel');
    if (!infoPanel) return;
    
    const distanciaKm = (segmento.distance / 1000).toFixed(1);
    const tiempoMin = Math.round(segmento.duration / 60);
    
    // Agregar panel de información de ruta
    const rutaInfo = document.createElement('div');
    rutaInfo.className = 'alert alert-info mt-3';
    rutaInfo.innerHTML = `
        <h6><i class="fas fa-route"></i> Ruta activa: ${destinoNombre}</h6>
        <div class="row">
            <div class="col-6">
                <i class="fas fa-road"></i> Distancia: <strong>${distanciaKm} km</strong>
            </div>
            <div class="col-6">
                <i class="fas fa-clock"></i> Tiempo estimado: <strong>${tiempoMin} min</strong>
            </div>
        </div>
    `;
    
    // Insertar al principio del panel
    infoPanel.insertBefore(rutaInfo, infoPanel.firstChild);
}


// ===============================
// Login
async function handleLogin(e) {
    e.preventDefault();
    
    const userId = document.getElementById('userId').value;
    const password = document.getElementById('password').value;
    
    try {
        const userSnapshot = await db.ref(`usuarios/${userId}`).once('value');
        const userData = userSnapshot.val();
        
        if (userData) {
            // Verificar contraseña
            const userPassword = userData.password || '123456'; // Default para usuarios antiguos
            
            if (password !== userPassword) {
                showAlert('Contraseña incorrecta', 'danger');
                return;
            }
            
            currentUser = userData;
            userRole = userData.rol;
            
            // Actualizar UI
            document.getElementById('userName').textContent = userData.nombre;
            document.getElementById('userRole').textContent = userRole;
            
            // Mostrar pantalla principal
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';
            
            // Cargar dashboard según rol
            loadDashboard();
            
            // Configurar notificaciones
            if ('Notification' in window && Notification.permission !== 'granted') {
                Notification.requestPermission();
            }
			if (window.AppInventor) {
                window.AppInventor.setWebViewString(JSON.stringify({
                    cmd: 'login',
                    id: currentUser.id,
                    rol: userRole
                }));
            }
            
            showAlert(`Bienvenido, ${userData.nombre}!`, 'success');
        } else {
            showAlert('Usuario no encontrado', 'danger');
        }
    } catch (error) {
        console.error('Error en login:', error);
        showAlert('Error al iniciar sesión', 'danger');
    }
}

// ===============================
// Cargar dashboard según rol
function loadDashboard() {
    const statsCards = document.getElementById('statsCards');
    const actionButtons = document.getElementById('actionButtons');
    
    // Limpiar contenido
    statsCards.innerHTML = '';
    actionButtons.innerHTML = '';
    
    // Cargar estadísticas
    loadStatistics();
    
    // Cargar botones según rol
    if (userRole === 'empleado') {
        actionButtons.innerHTML = `
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-primary h-100 p-3 w-100" onclick="showSolicitarViaje()">
                    <i class="fas fa-calendar-plus fa-2x mb-2"></i><br>
                    <strong>Solicitar Viaje</strong>
                </button>
            </div>
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-info h-100 p-3 w-100" onclick="showVerViajes()">
                    <i class="fas fa-list fa-2x mb-2"></i><br>
                    <strong>Ver Viajes</strong>
                </button>
            </div>
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-success h-100 p-3 w-100" onclick="showGPS()">
                    <i class="fas fa-map-marked-alt fa-2x mb-2"></i><br>
                    <strong>Rastrear Mi Vehículo</strong>
                </button>
            </div>
        `;
    } else if (userRole === 'chofer') {
        // v2: Choferes solo pueden ver viajes, no solicitar
        actionButtons.innerHTML = `
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-info h-100 p-3 w-100" onclick="showVerViajes()">
                    <i class="fas fa-list fa-2x mb-2"></i><br>
                    <strong>Ver Viajes Disponibles</strong>
                </button>
            </div>
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-warning h-100 p-3 w-100" onclick="showAlert('Los choferes no pueden acceder al GPS de flota', 'warning')">
                    <i class="fas fa-ban fa-2x mb-2"></i><br>
                    <strong>GPS No Disponible</strong>
                </button>
            </div>
        `;
    } else if (userRole === 'administrador') {
        actionButtons.innerHTML = `
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-primary h-100 p-3 w-100" onclick="showAdminPanel()">
                    <i class="fas fa-cog fa-2x mb-2"></i><br>
                    <strong>Panel Admin</strong>
                </button>
            </div>
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-info h-100 p-3 w-100" onclick="showVerViajes()">
                    <i class="fas fa-list fa-2x mb-2"></i><br>
                    <strong>Ver Viajes</strong>
                </button>
            </div>
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-success h-100 p-3 w-100" onclick="showGPS()">
                    <i class="fas fa-map-marked-alt fa-2x mb-2"></i><br>
                    <strong>GPS Flota</strong>
                </button>
            </div>
            <div class="col-md-6 col-lg-3 mb-3">
                <button class="btn btn-warning h-100 p-3 w-100" onclick="showSolicitarViaje()">
                    <i class="fas fa-calendar-plus fa-2x mb-2"></i><br>
                    <strong>Solicitar Viaje</strong>
                </button>
            </div>
        `;
    }
}

// ===============================
// Cargar estadísticas
async function loadStatistics() {
    const statsCards = document.getElementById('statsCards');
    
    try {
        // Obtener datos de Firebase
        const [solicitudesSnap, viajesSnap, vehiculosSnap] = await Promise.all([
            db.ref('solicitudes_viajes').once('value'),
            db.ref('viajes_disponibles').once('value'),
            db.ref('vehiculos').once('value')
        ]);
        
        const solicitudes = solicitudesSnap.val() || {};
        const viajes = viajesSnap.val() || {};
        const vehiculos = vehiculosSnap.val() || {};
        
        // Contar estadísticas
        const totalSolicitudes = Object.keys(solicitudes).length;
        const pendientes = Object.values(solicitudes).filter(s => s.estado === 'pendiente').length;
        const viajesHoy = Object.values(viajes).filter(v => {
            const hoy = new Date().toISOString().split('T')[0];
            return v.fecha === hoy;
        }).length;
        const vehiculosActivos = Object.values(vehiculos).filter(v => v.estado === 'activo').length;
        
        // Mostrar estadísticas según rol
        if (userRole === 'empleado') {
            const misSolicitudes = Object.values(solicitudes).filter(s => s.empleado_id === currentUser.id).length;
            statsCards.innerHTML = `
                <div class="col-md-6 col-lg-3 mb-3">
                    <div class="card stats-card">
                        <div class="card-body">
                            <h5 class="card-title">Mis Solicitudes</h5>
                            <h2 class="text-primary">${misSolicitudes}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-6 col-lg-3 mb-3">
                    <div class="card stats-card">
                        <div class="card-body">
                            <h5 class="card-title">Viajes Hoy</h5>
                            <h2 class="text-info">${viajesHoy}</h2>
                        </div>
                    </div>
                </div>
            `;
        } else if (userRole === 'administrador') {
            statsCards.innerHTML = `
                <div class="col-md-6 col-lg-3 mb-3">
                    <div class="card stats-card">
                        <div class="card-body">
                            <h5 class="card-title">Total Solicitudes</h5>
                            <h2 class="text-primary">${totalSolicitudes}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-6 col-lg-3 mb-3">
                    <div class="card stats-card">
                        <div class="card-body">
                            <h5 class="card-title">Pendientes</h5>
                            <h2 class="text-warning">${pendientes}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-6 col-lg-3 mb-3">
                    <div class="card stats-card">
                        <div class="card-body">
                            <h5 class="card-title">Viajes Hoy</h5>
                            <h2 class="text-info">${viajesHoy}</h2>
                        </div>
                    </div>
                </div>
                <div class="col-md-6 col-lg-3 mb-3">
                    <div class="card stats-card">
                        <div class="card-body">
                            <h5 class="card-title">Vehículos Activos</h5>
                            <h2 class="text-success">${vehiculosActivos}</h2>
                        </div>
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error cargando estadísticas:', error);
    }
}

// ===============================
// Navegación
function showDashboard() {
    hideAllScreens();
    document.getElementById('dashboardScreen').style.display = 'block';
    loadDashboard();
}

function showSolicitarViaje() {
    hideAllScreens();
    document.getElementById('solicitarViajeScreen').style.display = 'block';
    
    // Configurar formulario según rol
    if (userRole === 'administrador') {
        // Mostrar selector de chofer para admin
        document.getElementById('nombreField').style.display = 'none';
        document.getElementById('choferField').style.display = 'block';
        document.getElementById('choferAsignado').required = true;
        document.getElementById('nombreSolicitud').required = false;
        
        // Cargar choferes disponibles
        cargarChoferesDisponibles();
    } else {
        // Mostrar campo de nombre para empleados
        document.getElementById('nombreField').style.display = 'block';
        document.getElementById('choferField').style.display = 'none';
        document.getElementById('choferAsignado').required = false;
        document.getElementById('nombreSolicitud').required = true;
        
        // Prellenar datos del usuario
        document.getElementById('nombreSolicitud').value = currentUser.nombre;
        document.getElementById('idEmpleadoSolicitud').value = currentUser.id;
    }
}

function showVerViajes() {
    hideAllScreens();
    document.getElementById('verViajesScreen').style.display = 'block';
    
    // Mostrar alerta para choferes
    if (userRole === 'chofer') {
        document.getElementById('choferAlert').style.display = 'block';
    }
    
    cargarViajes();
}

function showGPS() {
    if (userRole === 'chofer') {
        showAlert('Los choferes no tienen acceso al GPS de flota', 'warning');
        return;
    }
    
    hideAllScreens();
    document.getElementById('gpsScreen').style.display = 'block';
    initializeMap();
}

function showAdminPanel() {
    if (userRole !== 'administrador') {
        showAlert('No tienes permisos para acceder a esta sección', 'danger');
        return;
    }
    
    hideAllScreens();
    document.getElementById('adminScreen').style.display = 'block';
    cargarDatosAdmin();
}

function hideAllScreens() {
    document.getElementById('dashboardScreen').style.display = 'none';
    document.getElementById('solicitarViajeScreen').style.display = 'none';
    document.getElementById('verViajesScreen').style.display = 'none';
    document.getElementById('gpsScreen').style.display = 'none';
    document.getElementById('adminScreen').style.display = 'none';
}

// ===============================
// Solicitar viaje (v2)
async function handleSolicitarViaje(e) {
    e.preventDefault();
    
    const destino = document.getElementById('destinoSolicitud').value === 'otro' 
        ? document.getElementById('otroDestino').value 
        : document.getElementById('destinoSolicitud').value;
    const hora = document.getElementById('horaSolicitud').value;
    const tipoVehiculo = document.getElementById('tipoVehiculo').value;
    const comentarios = document.getElementById('comentarios').value;
    
    let solicitudData = {
        destino: destino,
        hora: hora,
        tipo_vehiculo_preferido: tipoVehiculo,
        estado: 'pendiente',
        fecha: new Date().toLocaleString('es-DO'),
        timestamp: Date.now(),
        comentarios: comentarios,
        prioridad: 'normal'
    };
    
    // Si es admin creando viaje directo con chofer asignado
    if (userRole === 'administrador') {
        const choferId = document.getElementById('choferAsignado').value;
        if (!choferId) {
            showAlert('Debe seleccionar un chofer', 'warning');
            return;
        }
        
        const choferData = await db.ref(`usuarios/${choferId}`).once('value');
        const chofer = choferData.val();
        
        // Crear viaje directo
        const viajeId = 'viaje_' + Date.now();
        const viaje = {
            id: viajeId,
            destino: destino,
            fecha: new Date().toISOString().split('T')[0],
            hora: hora,
            tipo_vehiculo: tipoVehiculo || 'camioneta',
            chofer: chofer.nombre,
            chofer_id: choferId,
            vehiculo_id: chofer.vehiculo_asignado,
            estado: 'programado',
            espacios_disponibles: (VEHICLE_CAPACITIES[tipoVehiculo || 'camioneta'] || 0) - 1,
            capacidad_total: VEHICLE_CAPACITIES[tipoVehiculo || 'camioneta'] || 0,
            pasajeros: [],
            creado_por: currentUser.id
        };
        
        await db.ref(`viajes_disponibles/${viajeId}`).set(viaje);
        showAlert('Viaje creado y asignado exitosamente!', 'success');
        document.getElementById('solicitarViajeForm').reset();
        showDashboard();
        return;
    }
    
    // Si es empleado, crear solicitud normal
    const solicitudId = 'sol_' + Date.now();
    solicitudData.id = solicitudId;
    solicitudData.empleado_id = currentUser.id;
    solicitudData.nombre = currentUser.nombre;
    
    // Verificar capacidad si se especificó tipo de vehículo
    if (tipoVehiculo) {
        const capacidadDisponible = await verificarCapacidad(tipoVehiculo, hora);
        if (!capacidadDisponible) {
            showAlert(`No hay espacios disponibles en ${tipoVehiculo} para esa hora. Capacidad máxima: ${VEHICLE_CAPACITIES[tipoVehiculo]} pasajeros.`, 'warning');
            return;
        }
    }
    
    try {
        // Guardar solicitud
        await db.ref(`solicitudes_viajes/${solicitudId}`).set(solicitudData);
        await db.ref(`solicitudes_viajes_por_empleado/${currentUser.id}/${solicitudId}`).set(solicitudId);
        
        // Notificar a administradores
        notificarAdministradores('Nueva solicitud de viaje', `${currentUser.nombre} ha solicitado un viaje a ${destino}`);
        
        showAlert('Solicitud enviada exitosamente! Recibirás una notificación cuando sea aprobada.', 'success');
        document.getElementById('solicitarViajeForm').reset();
        showDashboard();
    } catch (error) {
        console.error('Error al solicitar viaje:', error);
        showAlert('Error al enviar la solicitud', 'danger');
    }
}

// ===============================
// Verificar capacidad disponible
async function verificarCapacidad(tipoVehiculo, hora) {
    try {
        const viajesSnap = await db.ref('viajes_disponibles')
            .orderByChild('tipo_vehiculo')
            .equalTo(tipoVehiculo)
            .once('value');
        
        const viajes = viajesSnap.val() || {};
        const capacidadMaxima = VEHICLE_CAPACITIES[tipoVehiculo];
        
        for (const viajeId in viajes) {
            const viaje = viajes[viajeId];
            if (viaje.hora === hora && viaje.espacios_disponibles <= 0) {
                return false;
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error verificando capacidad:', error);
        return true; // Permitir en caso de error
    }
}

// ===============================
// Cargar viajes disponibles (**parcheado**)
async function cargarViajes() {
    const container = document.getElementById('viajesContainer');
    if (!container) {
        console.warn('No se encontró el contenedor #viajesContainer');
        return;
    }

    container.innerHTML = '<div class="text-center"><div class="spinner-border" role="status"></div></div>';
    
    try {
        const viajesSnap = await db.ref('viajes_disponibles').once('value');
        const viajes = viajesSnap.val() || {};
        
        container.innerHTML = '';
        
        if (Object.keys(viajes).length === 0) {
            container.innerHTML = '<div class="col-12"><div class="alert alert-info">No hay viajes disponibles en este momento.</div></div>';
            return;
        }
        
        Object.entries(viajes).forEach(([id, viaje]) => {
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-4 mb-3';
            
            const estadoClass = viaje.estado === 'programado' ? 'success' : 'secondary';
            const total = Number.isFinite(viaje.capacidad_total) ? viaje.capacidad_total : 0;
            const libres = Number.isFinite(viaje.espacios_disponibles) ? viaje.espacios_disponibles : 0;
            const puedeUnirse = userRole !== 'chofer' && libres > 0;
            
            // Determinar el icono del vehículo
            let vehiculoIcon = 'bus';
            if (viaje.tipo_vehiculo === 'camioneta') {
                vehiculoIcon = 'truck';
            } else if (viaje.tipo_vehiculo === 'van') {
                vehiculoIcon = 'shuttle-van';
            }
            
            card.innerHTML = `
                <div class="card">
                    <div class="card-header bg-${estadoClass} text-white">
                        <i class="fas fa-route"></i> ${viaje.destino}
                    </div>
                    <div class="card-body">
                        <p><i class="fas fa-calendar"></i> <strong>Fecha:</strong> ${viaje.fecha || '—'}</p>
                        <p><i class="fas fa-clock"></i> <strong>Hora:</strong> ${viaje.hora ? formatearHora12(viaje.hora) : '—'}</p>
                        <p><i class="fas fa-user"></i> <strong>Chofer:</strong> ${viaje.chofer || 'No asignado'}</p>
                        <p><i class="fas fa-${vehiculoIcon}"></i> 
                           <strong>Vehículo:</strong> ${viaje.tipo_vehiculo || '—'} (${viaje.placa || 'Sin placa'})</p>
                        <p><i class="fas fa-users"></i> <strong>Espacios:</strong> 
                           <span class="badge bg-${libres > 0 ? 'success' : 'danger'}">
                               ${libres} / ${total}
                           </span>
                        </p>
                        ${puedeUnirse ? `
                            <button class="btn btn-primary btn-sm" onclick="unirseAViaje('${id}')">
                                <i class="fas fa-plus-circle"></i> Unirse al viaje
                            </button>
                        ` : userRole === 'chofer' ? `
                            <span class="text-muted"><i class="fas fa-eye"></i> Solo visualización</span>
                            ${viaje.chofer_id === currentUser.id && viaje.estado === 'programado' ? `
                                <br>
                                <button class="btn btn-success btn-sm mt-2" onclick="completarViaje('${id}')">
                                    <i class="fas fa-check-circle"></i> Completar Viaje
                                </button>
                            ` : ''}
                        ` : `
                            <span class="text-danger"><i class="fas fa-times-circle"></i> Viaje lleno</span>
                        `}
                    </div>
                </div>
            `;
            
            container.appendChild(card);
        });
    } catch (error) {
        console.error('Error cargando viajes:', error);
        container.innerHTML = '<div class="col-12"><div class="alert alert-danger">Error al cargar los viajes. Por favor, verifique la conexión.</div></div>';
    }
}

// ===============================
// Inicializar mapa
function initializeMap() {
    if (!map) {
        map = L.map('mapaFlota').setView([18.4861, -69.9312], 13);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);
        
        // Marcador de la empresa
        L.marker([18.4861, -69.9312])
            .addTo(map)
            .bindPopup('<strong>PRO-REQUEST</strong><br>Sede Principal')
            .openPopup();
    }
    
    // Cargar vehículos
    cargarVehiculosEnMapa();
    
    // Actualizar cada 30 segundos
    if (gpsInterval) clearInterval(gpsInterval);
    gpsInterval = setInterval(cargarVehiculosEnMapa, 30000);
}

// ===============================
// Cargar vehículos en el mapa

// Modificar la función cargarVehiculosEnMapa existente
async function cargarVehiculosEnMapa() {
    try {
        const flotillaSnap = await db.ref('flotillas_gps').once('value');
        const flotilla = flotillaSnap.val() || {};
        
        // Cargar viajes activos para obtener destinos
        const viajesSnap = await db.ref('viajes_disponibles')
            .orderByChild('estado')
            .equalTo('programado')
            .once('value');
        const viajesActivos = viajesSnap.val() || {};
        
        // Crear mapa de vehículo -> destino
        const vehiculoDestinos = {};
        Object.values(viajesActivos).forEach(viaje => {
            if (viaje.vehiculo_id && viaje.estado === 'programado') {
                vehiculoDestinos[viaje.vehiculo_id] = viaje.destino;
            }
        });
        
        const infoPanel = document.getElementById('vehicleInfoPanel');
        infoPanel.innerHTML = '<h5>Vehículos en tiempo real:</h5><div class="row">';
        
        // Si es chofer, filtrar solo su vehículo
        let vehiculosAMostrar = flotilla;
        if (userRole === 'chofer' && currentUser.vehiculo_asignado) {
            vehiculosAMostrar = {};
            if (flotilla[currentUser.vehiculo_asignado]) {
                vehiculosAMostrar[currentUser.vehiculo_asignado] = flotilla[currentUser.vehiculo_asignado];
            }
        }
        
        Object.entries(vehiculosAMostrar).forEach(([vehiculoId, data]) => {
            // Actualizar o crear marcador
            if (markers[vehiculoId]) {
                markers[vehiculoId].setLatLng([data.lat, data.lng]);
            } else {
                const icon = L.divIcon({
                    html: `<i class="fas fa-${data.tipo_vehiculo === 'camioneta' ? 'truck' : data.tipo_vehiculo === 'van' ? 'shuttle-van' : 'bus'} fa-2x" style="color: ${data.activo ? 'green' : 'red'}"></i>`,
                    iconSize: [30, 30],
                    className: 'vehicle-icon'
                });
                
                markers[vehiculoId] = L.marker([data.lat, data.lng], { icon })
                    .addTo(map)
                    .bindPopup(`
                        <strong>${data.placa}</strong><br>
                        Chofer: ${data.chofer}<br>
                        Velocidad: ${data.velocidad} km/h<br>
                        Estado: ${data.activo ? 'En movimiento' : 'Detenido'}<br>
                        ${vehiculoDestinos[vehiculoId] ? `Destino: ${vehiculoDestinos[vehiculoId]}` : ''}
                    `);
            }
            
            // Dibujar ruta si el vehículo tiene destino activo
            if (vehiculoDestinos[vehiculoId] && data.activo) {
                const origen = { lat: data.lat, lng: data.lng };
                dibujarRutaEnMapa(vehiculoId, origen, vehiculoDestinos[vehiculoId], 'simple');
            }
            
            // Agregar info al panel con botón para ver ruta
            const esPropio = userRole === 'chofer' && vehiculoId === currentUser.vehiculo_asignado;
            const tieneDestino = vehiculoDestinos[vehiculoId];
            
            infoPanel.innerHTML += `
                <div class="col-md-6 mb-2">
                    <div class="card ${data.activo ? 'border-success' : 'border-secondary'} ${esPropio ? 'bg-light' : ''}">
                        <div class="card-body p-2">
                            <h6>${data.placa} - ${data.tipo_vehiculo} ${esPropio ? '<span class="badge bg-primary">Mi Vehículo</span>' : ''}</h6>
                            <small>
                                <i class="fas fa-user"></i> ${data.chofer}<br>
                                <i class="fas fa-tachometer-alt"></i> ${data.velocidad} km/h<br>
                                <i class="fas fa-compass"></i> ${data.direccion}<br>
                                <i class="fas fa-clock"></i> ${data.ultimo_update}<br>
                                <i class="fas fa-gas-pump"></i> Combustible: ${data.nivel_combustible}%<br>
                                ${tieneDestino ? `<i class="fas fa-map-marker-alt"></i> Destino: ${vehiculoDestinos[vehiculoId]}<br>` : ''}
                            </small>
                            ${tieneDestino && userRole === 'administrador' ? `
                                <button class="btn btn-sm btn-primary mt-2" onclick="verRutaDetallada('${vehiculoId}', ${data.lat}, ${data.lng}, '${vehiculoDestinos[vehiculoId]}')">
                                    <i class="fas fa-route"></i> Ver ruta
                                </button>
                            ` : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        
        infoPanel.innerHTML += '</div>';
        
        // Si es empleado, mostrar notificación de proximidad
        if (userRole === 'empleado') {
            mostrarNotificacionProximidad(flotilla);
        }
        
        // Si es chofer y tiene vehículo, centrar mapa en su vehículo
        if (userRole === 'chofer' && currentUser.vehiculo_asignado && vehiculosAMostrar[currentUser.vehiculo_asignado]) {
            const miVehiculo = vehiculosAMostrar[currentUser.vehiculo_asignado];
            map.setView([miVehiculo.lat, miVehiculo.lng], 15);
        }
    } catch (error) {
        console.error('Error cargando vehículos:', error);
    }
}

// Función para ver ruta con API real
async function verRutaDetallada(vehiculoId, lat, lng, destinoNombre) {
    const origen = { lat: lat, lng: lng };
    await dibujarRutaEnMapa(vehiculoId, origen, destinoNombre, 'real');
}

// Actualizar ruta cuando el vehículo se mueve
function actualizarRutaDinamica(vehiculoId, nuevaLat, nuevaLng, destino) {
    if (rutasActivas[vehiculoId]) {
        const origen = { lat: nuevaLat, lng: nuevaLng };
        // Redibujar la ruta desde la nueva posición
        dibujarRutaEnMapa(vehiculoId, origen, destino, rutasActivas[vehiculoId].tipo);
    }
}

// ===============================
// Mostrar notificación de proximidad
function mostrarNotificacionProximidad(flotilla) {
    // Simular cálculo de distancia
    const distanciaSimulada = Math.floor(Math.random() * 10) + 1;
    
    if (distanciaSimulada < 5) {
        mostrarNotificacion('Vehículo cercano', `Tu transporte llegará en aproximadamente ${distanciaSimulada} minutos`);
    }
}

// ===============================
// Panel de administración
async function cargarDatosAdmin() {
    // Cargar solicitudes pendientes
    cargarSolicitudesPendientes();
    
    // Cargar lista de vehículos
    cargarListaVehiculos();
	if (typeof cargarChoferesSinVehiculo === 'function') {
       cargarChoferesSinVehiculo();
    }
    if (typeof cargarVehiculosSinChofer === 'function') {
       cargarVehiculosSinChofer();
    }
	//cargarChoferesSinVehiculo();
    //cargarVehiculosSinChofer();
}

// ===============================
// Cargar solicitudes pendientes (**parcheado en hora**)
async function cargarSolicitudesPendientes() {
    const tbody = document.getElementById('solicitudesTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner-border" role="status"></div></td></tr>';
    
    try {
        const solicitudesSnap = await db.ref('solicitudes_viajes').once('value');
        const solicitudes = solicitudesSnap.val() || {};
        
        tbody.innerHTML = '';
        
        for (const [id, solicitud] of Object.entries(solicitudes)) {
            const row = document.createElement('tr');
            const estadoClass = solicitud.estado === 'pendiente' ? 'warning' : solicitud.estado === 'aprobado' ? 'success' : 'danger';
            
            // Si está pendiente, cargar choferes disponibles
            let choferesOptions = '';
            if (solicitud.estado === 'pendiente') {
                const choferesDisponibles = await obtenerChoferesDisponibles();
                choferesOptions = '<select class="form-select form-select-sm" id="chofer_' + id + '">';
                choferesOptions += '<option value="">Seleccionar chofer...</option>';
                Object.entries(choferesDisponibles).forEach(([choferId, chofer]) => {
                    choferesOptions += `<option value="${choferId}">${chofer.nombre}</option>`;
                });
                choferesOptions += '</select>';
            } else {
                choferesOptions = solicitud.chofer_asignado || '-';
            }
            
            row.innerHTML = `
                <td>${solicitud.fecha || '—'}</td>
                <td>${solicitud.nombre || '—'}</td>
                <td>${solicitud.destino || '—'}</td>
                <td>${solicitud.hora ? formatearHora12(solicitud.hora) : '—'}</td>
                <td><span class="badge bg-${estadoClass}">${solicitud.estado}</span></td>
                <td>${choferesOptions}</td>
                <td>
                    ${solicitud.estado === 'pendiente' ? `
                        <button class="btn btn-success btn-sm" onclick="aprobarSolicitudConChofer('${id}')">
                            <i class="fas fa-check"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="rechazarSolicitud('${id}')">
                            <i class="fas fa-times"></i>
                        </button>
                    ` : '-'}
                </td>
            `;
            
            tbody.appendChild(row);
        }
        
        if (tbody.innerHTML === '') {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay solicitudes</td></tr>';
        }
    } catch (error) {
        console.error('Error cargando solicitudes:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">Error al cargar solicitudes</td></tr>';
    }
}

// ===============================
// Cargar lista de vehículos
async function cargarListaVehiculos() {
    const tbody = document.getElementById('vehiculosTableBody');
    
    try {
        const vehiculosSnap = await db.ref('vehiculos').once('value');
        const vehiculos = vehiculosSnap.val() || {};
        
        tbody.innerHTML = '';
        
        Object.entries(vehiculos).forEach(([id, vehiculo]) => {
            const row = document.createElement('tr');
            const estadoClass = vehiculo.estado === 'activo' ? 'success' : 'warning';
            
            row.innerHTML = `
                <td>${id}</td>
                <td>${vehiculo.placa}</td>
                <td>${vehiculo.tipo}</td>
                <td>${vehiculo.capacidad}</td>
                <td><span class="badge bg-${estadoClass}">${vehiculo.estado}</span></td>
                <td>${vehiculo.chofer_asignado || 'Sin asignar'}</td>
            `;
            
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error cargando vehículos:', error);
    }
}

// ===============================
// Aprobar solicitud con chofer asignado
async function aprobarSolicitudConChofer(solicitudId) {
    const choferId = document.getElementById(`chofer_${solicitudId}`).value;
    
    if (!choferId) {
        showAlert('Debe seleccionar un chofer para aprobar la solicitud', 'warning');
        return;
    }
    
    try {
        // Obtener datos de la solicitud
        const solicitudSnap = await db.ref(`solicitudes_viajes/${solicitudId}`).once('value');
        const solicitud = solicitudSnap.val();
        
        // Obtener datos del chofer
        const choferSnap = await db.ref(`usuarios/${choferId}`).once('value');
        const chofer = choferSnap.val();
        
        // Crear viaje
        const viajeId = 'viaje_' + Date.now();
        const tipoVeh = solicitud.tipo_vehiculo_preferido || 'camioneta';
        const cap = VEHICLE_CAPACITIES[tipoVeh] || 0;

        const viaje = {
            id: viajeId,
            destino: solicitud.destino,
            fecha: new Date().toISOString().split('T')[0],
            hora: solicitud.hora || '',
            tipo_vehiculo: tipoVeh,
            chofer: chofer.nombre,
            chofer_id: choferId,
            vehiculo_id: chofer.vehiculo_asignado,
            estado: 'programado',
            espacios_disponibles: cap > 0 ? cap - 1 : 0,
            capacidad_total: cap,
            pasajeros: [solicitud.empleado_id],
            solicitud_origen: solicitudId
        };
        
        // Guardar viaje
        await db.ref(`viajes_disponibles/${viajeId}`).set(viaje);
        
        // Actualizar solicitud
        await db.ref(`solicitudes_viajes/${solicitudId}`).update({
            estado: 'aprobado',
            aprobado_por: currentUser.id,
            fecha_aprobacion: new Date().toLocaleString('es-DO'),
            chofer_asignado: chofer.nombre,
            viaje_id: viajeId
        });
        
        // Notificar al empleado
        mostrarNotificacion('Solicitud aprobada', `El viaje a ${solicitud.destino} ha sido aprobado`);
        
        showAlert('Solicitud aprobada y viaje creado exitosamente', 'success');
        cargarSolicitudesPendientes();
    } catch (error) {
        console.error('Error aprobando solicitud:', error);
        showAlert('Error al aprobar la solicitud', 'danger');
    }
}

// ===============================
// Rechazar solicitud
async function rechazarSolicitud(solicitudId) {
    if (!confirm('¿Está seguro de rechazar esta solicitud?')) return;
    
    try {
        await db.ref(`solicitudes_viajes/${solicitudId}`).update({
            estado: 'rechazado',
            rechazado_por: currentUser.id,
            fecha_rechazo: new Date().toLocaleString('es-DO')
        });
        
        showAlert('Solicitud rechazada', 'info');
        cargarSolicitudesPendientes();
    } catch (error) {
        console.error('Error rechazando solicitud:', error);
        showAlert('Error al rechazar la solicitud', 'danger');
    }
}

// ===============================
// Registrar usuario (v2)
async function handleRegistrarUsuario(e) {
    e.preventDefault();
    
    const userId = document.getElementById('nuevoUserId').value;
    const tipo = document.getElementById('nuevoUserTipo').value;
    const nombre = document.getElementById('nuevoUserNombre').value;
    const email = document.getElementById('nuevoUserEmail').value;
    const telefono = document.getElementById('nuevoUserTelefono').value;
    const password = document.getElementById('nuevoUserPassword').value;
    const passwordConfirm = document.getElementById('nuevoUserPasswordConfirm').value;
    
    // Verificar contraseñas coincidentes
    if (password !== passwordConfirm) {
        showAlert('Las contraseñas no coinciden', 'danger');
        return;
    }
    
    // Verificar si el ID ya existe
    const exists = await verificarIdExistente(userId);
    if (exists) {
        showAlert('El ID de usuario ya existe. Por favor, elija otro.', 'danger');
        document.getElementById('nuevoUserId').classList.add('is-invalid');
        return;
    }
    
    const nuevoUsuario = {
        id: userId,
        nombre: nombre,
        email: email,
        rol: tipo,
        telefono: telefono,
        password: password, // Guardar contraseña
        activo: true,
        fecha_registro: new Date().toISOString().split('T')[0]
    };
    
    if (tipo === 'empleado') {
        nuevoUsuario.departamento = document.getElementById('nuevoUserDepartamento').value;
        nuevoUsuario.vehiculo_asignado = null;
	if (tipo === 'chofer') {
       await crearEntradaGPSInicial(userId, nombre);
    }
    } else if (tipo === 'chofer') {
        nuevoUsuario.licencia = document.getElementById('nuevoUserLicencia').value;
        nuevoUsuario.vehiculo_asignado = null; // Asignar después
        nuevoUsuario.experiencia_anos = 0;
    }
    
    try {
        // Crear usuario
        await db.ref(`usuarios/${userId}`).set(nuevoUsuario);
		        
        showAlert(`Usuario ${nombre} registrado exitosamente con ID: ${userId}`, 'success');
        document.getElementById('registrarUsuarioForm').reset();
		
		
        
        // Enviar notificación
        mostrarNotificacion('Usuario registrado', `Se ha creado el usuario ${userId} - ${nombre}`);
    } catch (error) {
        console.error('Error registrando usuario:', error);
        showAlert('Error al registrar el usuario', 'danger');
    }
}



async function crearEntradaGPSInicial(choferId, nombreChofer) {
    const entradaGPS = {
        vehiculo_id: null, // Sin vehículo asignado aún
        lat: 18.4861, // Coordenadas por defecto (empresa)
        lng: -69.9312,
        timestamp: Date.now(),
        velocidad: 0,
        direccion: "Norte",
        activo: false,
        chofer: nombreChofer,
        chofer_id: choferId,
        placa: "Sin asignar",
        ultimo_update: new Date().toLocaleTimeString('es-DO'),
        estado_motor: "apagado",
        nivel_combustible: 0,
        tipo_vehiculo: "sin asignar"
    };
    
    // Guardar con el ID del chofer temporalmente
    await db.ref(`flotillas_gps/TEMP_${choferId}`).set(entradaGPS);
}

// AGREGAR estas funciones

async function asignarVehiculoAChofer(choferId, vehiculoId) {
    try {
        // Obtener datos del vehículo
        const vehiculoSnap = await db.ref(`vehiculos/${vehiculoId}`).once('value');
        const vehiculo = vehiculoSnap.val();
        
        // Obtener datos del chofer
        const choferSnap = await db.ref(`usuarios/${choferId}`).once('value');
        const chofer = choferSnap.val();
        
        // Actualizar chofer con vehículo
        await db.ref(`usuarios/${choferId}/vehiculo_asignado`).set(vehiculoId);
        
        // Actualizar vehículo con chofer
        await db.ref(`vehiculos/${vehiculoId}/chofer_asignado`).set(choferId);
        
        // Eliminar entrada temporal si existe
        await db.ref(`flotillas_gps/TEMP_${choferId}`).remove();
        
        // Crear/actualizar entrada en flotillas_gps con el vehículo real
        const entradaGPS = {
            vehiculo_id: vehiculoId,
            lat: 18.4861,
            lng: -69.9312,
            timestamp: Date.now(),
            velocidad: 0,
            direccion: "Norte",
            activo: false,
            chofer: chofer.nombre,
            chofer_id: choferId,
            placa: vehiculo.placa,
            ultimo_update: new Date().toLocaleTimeString('es-DO'),
            estado_motor: "apagado",
            nivel_combustible: vehiculo.nivel_combustible || 50,
            tipo_vehiculo: vehiculo.tipo
        };
        
        await db.ref(`flotillas_gps/${vehiculoId}`).set(entradaGPS);
        
        showAlert(`Vehículo ${vehiculo.placa} asignado a ${chofer.nombre}`, 'success');
    } catch (error) {
        console.error('Error asignando vehículo:', error);
        showAlert('Error al asignar vehículo', 'danger');
    }
}

async function cargarChoferesSinVehiculo() {
    const select = document.getElementById('choferParaVehiculo');
    select.innerHTML = '<option value="">Seleccione un chofer...</option>';
    
    try {
        const choferesSnap = await db.ref('usuarios')
            .orderByChild('rol')
            .equalTo('chofer')
            .once('value');
        
        const choferes = choferesSnap.val() || {};
        
        Object.entries(choferes).forEach(([id, chofer]) => {
            if (!chofer.vehiculo_asignado) {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${chofer.nombre} (${id})`;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Error cargando choferes:', error);
    }
}

async function cargarVehiculosSinChofer() {
    const select = document.getElementById('vehiculoParaChofer');
    select.innerHTML = '<option value="">Seleccione un vehículo...</option>';
    
    try {
        const vehiculosSnap = await db.ref('vehiculos').once('value');
        const vehiculos = vehiculosSnap.val() || {};
        
        Object.entries(vehiculos).forEach(([id, vehiculo]) => {
            if (!vehiculo.chofer_asignado && vehiculo.estado === 'activo') {
                const option = document.createElement('option');
                option.value = id;
                option.textContent = `${vehiculo.placa} - ${vehiculo.marca} ${vehiculo.modelo}`;
                select.appendChild(option);
            }
        });
    } catch (error) {
        console.error('Error cargando vehículos:', error);
    }
}

// ===============================
// Configurar capacidad de vehículos (v2)
async function handleConfigurarCapacidad(e) {
    e.preventDefault();
    
    const capacidades = {
        camioneta: parseInt(document.getElementById('capacidadCamioneta').value),
        van: parseInt(document.getElementById('capacidadVan').value),
        bus: parseInt(document.getElementById('capacidadBus').value)
    };
    
    try {
        await db.ref('configuracion/capacidades_vehiculos').set(capacidades);
        VEHICLE_CAPACITIES = capacidades;
        
        showAlert('Capacidades actualizadas exitosamente', 'success');
        
        // Actualizar vehículos existentes
        const vehiculosSnap = await db.ref('vehiculos').once('value');
        const vehiculos = vehiculosSnap.val() || {};
        
        for (const [id, vehiculo] of Object.entries(vehiculos)) {
            if (capacidades[vehiculo.tipo]) {
                await db.ref(`vehiculos/${id}/capacidad`).set(capacidades[vehiculo.tipo]);
            }
        }
    } catch (error) {
        console.error('Error configurando capacidades:', error);
        showAlert('Error al actualizar las capacidades', 'danger');
    }
}

// ===============================
// Exportar viajes (v2)
async function handleExportar(e) {
    e.preventDefault();
    
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const formato = document.getElementById('formatoExport').value;
    
    try {
        const viajesSnap = await db.ref('viajes_disponibles').once('value');
        const viajes = viajesSnap.val() || {};
        
        // Filtrar por fecha
        const viajesFiltrados = Object.entries(viajes).filter(([id, viaje]) => {
            return viaje.fecha >= fechaInicio && viaje.fecha <= fechaFin;
        });
        
        if (viajesFiltrados.length === 0) {
            showAlert('No hay viajes en el rango de fechas seleccionado', 'warning');
            return;
        }
        
        // Exportar según formato
        switch (formato) {
            case 'csv':
                exportarCSV(viajesFiltrados);
                break;
            case 'excel':
                showAlert('Exportación a Excel en desarrollo', 'info');
                break;
            case 'pdf':
                showAlert('Exportación a PDF en desarrollo', 'info');
                break;
        }
        
        // Registrar exportación
        await db.ref('historial_exportaciones').push({
            fecha: new Date().toISOString().split('T')[0],
            usuario: currentUser.id,
            tipo: formato,
            rango_inicio: fechaInicio,
            rango_fin: fechaFin,
            total_registros: viajesFiltrados.length
        });
    } catch (error) {
        console.error('Error exportando:', error);
        showAlert('Error al exportar los datos', 'danger');
    }
}

// ===============================
// Exportar a CSV
function exportarCSV(viajes) {
    let csv = 'ID,Fecha,Destino,Hora,Chofer,Vehiculo,Placa,Capacidad,Espacios Disponibles,Estado\n';
    
    viajes.forEach(([id, viaje]) => {
        csv += `${id},${viaje.fecha},${viaje.destino},${viaje.hora},${viaje.chofer},${viaje.tipo_vehiculo},${viaje.placa},${viaje.capacidad_total},${viaje.espacios_disponibles},${viaje.estado}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `viajes_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showAlert('Archivo CSV descargado exitosamente', 'success');
}

// ===============================
// Borrar historial (v2)
async function borrarHistorial() {
    if (!confirm('¿Está seguro de borrar TODO el historial de viajes completados?')) return;
    
    const confirmacion = prompt('Escriba "BORRAR HISTORIAL" para confirmar:');
    if (confirmacion !== 'BORRAR HISTORIAL') {
        showAlert('Operación cancelada', 'info');
        return;
    }
    
    try {
        // Obtener viajes completados
        const viajesSnap = await db.ref('viajes_disponibles')
            .orderByChild('estado')
            .equalTo('completado')
            .once('value');
        
        const viajesCompletados = viajesSnap.val() || {};
        const totalBorrados = Object.keys(viajesCompletados).length;
        
        // Borrar cada viaje completado
        for (const viajeId in viajesCompletados) {
            await db.ref(`viajes_disponibles/${viajeId}`).remove();
        }
        
        showAlert(`Se han borrado ${totalBorrados} viajes completados del historial`, 'success');
        
        // Registrar la acción
        await db.ref('logs_sistema').push({
            accion: 'borrar_historial',
            usuario: currentUser.id,
            fecha: new Date().toISOString(),
            viajes_borrados: totalBorrados
        });
    } catch (error) {
        console.error('Error borrando historial:', error);
        showAlert('Error al borrar el historial', 'danger');
    }
}

// ===============================
// Completar viaje (para choferes)
async function completarViaje(viajeId) {
    if (!confirm('¿Está seguro de marcar este viaje como completado?')) return;
    
    try {
        // Actualizar estado del viaje
        await db.ref(`viajes_disponibles/${viajeId}`).update({
            estado: 'completado',
            fecha_completado: new Date().toLocaleString('es-DO'),
            completado_por: currentUser.id
        });
        
        // Notificar
        mostrarNotificacion('Viaje completado', 'El viaje ha sido marcado como completado');
        showAlert('Viaje completado exitosamente', 'success');
        
        // Recargar viajes
        cargarViajes();
    } catch (error) {
        console.error('Error completando viaje:', error);
        showAlert('Error al completar el viaje', 'danger');
    }
}

// ===============================
// Unirse a un viaje
async function unirseAViaje(viajeId) {
    if (userRole === 'chofer') {
        showAlert('Los choferes no pueden unirse a viajes', 'warning');
        return;
    }
    
    try {
        const viajeSnap = await db.ref(`viajes_disponibles/${viajeId}`).once('value');
        const viaje = viajeSnap.val();
        
        if (!viaje) {
            showAlert('El viaje no existe', 'danger');
            return;
        }
        
        const libres = Number.isFinite(viaje.espacios_disponibles) ? viaje.espacios_disponibles : 0;
        if (libres <= 0) {
            showAlert('No hay espacios disponibles en este viaje', 'warning');
            return;
        }
        
        // Verificar si ya está en el viaje
        if (viaje.pasajeros && viaje.pasajeros.includes(currentUser.id)) {
            showAlert('Ya estás registrado en este viaje', 'info');
            return;
        }
        
        // Actualizar viaje
        const nuevosPasajeros = viaje.pasajeros || [];
        nuevosPasajeros.push(currentUser.id);
        
        await db.ref(`viajes_disponibles/${viajeId}`).update({
            pasajeros: nuevosPasajeros,
            espacios_disponibles: libres - 1
        });
        
        showAlert('Te has unido al viaje exitosamente!', 'success');
        cargarViajes();
        
        // Notificar
        mostrarNotificacion('Viaje confirmado', `Te has unido al viaje a ${viaje.destino} para las ${viaje.hora ? formatearHora12(viaje.hora) : '—'}`);
    } catch (error) {
        console.error('Error uniéndose al viaje:', error);
        showAlert('Error al unirse al viaje', 'danger');
    }
}

// ===============================
// Notificar a administradores
async function notificarAdministradores(titulo, mensaje) {
    try {
        // Obtener administradores
        const usuariosSnap = await db.ref('usuarios')
            .orderByChild('rol')
            .equalTo('administrador')
            .once('value');
        
        const administradores = usuariosSnap.val() || {};
        
        // Crear notificación para cada admin
        for (const adminId in administradores) {
            await db.ref('notificaciones_admin').push({
                titulo: titulo,
                mensaje: mensaje,
                timestamp: Date.now(),
                leida: false,
                tipo: 'solicitud'
            });
        }
        
        // Mostrar notificación push si es posible
        mostrarNotificacion(titulo, mensaje);
    } catch (error) {
        console.error('Error notificando administradores:', error);
    }
}

// ===============================
// Mostrar notificación
function mostrarNotificacion(titulo, mensaje) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(titulo, {
            body: mensaje,
            icon: 'images/logo.png',
            badge: 'images/logo.png',
            vibrate: [200, 100, 200]
        });
    } else {
        console.log(`Notificación: ${titulo} - ${mensaje}`);
    }
}

// ===============================
// Mostrar alertas
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 start-50 translate-middle-x mt-3`;
    alertDiv.style.zIndex = '9999';
    alertDiv.style.minWidth = '300px';
    
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// ===============================
// Logout
function logout() {
    if (confirm('¿Está seguro de cerrar sesión?')) {
        // ⭐ AGREGAR - Notificar a Kodular/Android Studio sobre el logout
        if (window.AppInventor) {
            window.AppInventor.setWebViewString(JSON.stringify({
                cmd: 'logout'
            }));
        }
        
        // ⭐ AGREGAR - Limpiar listeners en tiempo real
        if (typeof clearRealtimeListeners === 'function') {
            clearRealtimeListeners();
        }
        
        currentUser = null;
        userRole = null;
        
        if (gpsInterval) {
            clearInterval(gpsInterval);
            gpsInterval = null;
        }
        
        document.getElementById('mainApp').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
        document.getElementById('loginForm').reset();
        
        showAlert('Sesión cerrada exitosamente', 'info');
    }
}

// ===============================
// Simulación GPS para pruebas
if (window.location.hostname === 'localhost' || window.location.protocol === 'file:') {
    console.log('🖥️ Modo testing local detectado - Simulando GPS');
    
    // Simular movimiento de vehículos cada 30 segundos
    setInterval(async () => {
        try {
            const flotillaSnap = await db.ref('flotillas_gps').once('value');
            const flotilla = flotillaSnap.val() || {};
            
            for (const [vehiculoId, data] of Object.entries(flotilla)) {
                // Simular movimiento aleatorio
                const newLat = data.lat + (Math.random() - 0.5) * 0.01;
                const newLng = data.lng + (Math.random() - 0.5) * 0.01;
                const velocidad = Math.floor(Math.random() * 60);
                const direcciones = ['Norte', 'Sur', 'Este', 'Oeste'];
                const direccion = direcciones[Math.floor(Math.random() * direcciones.length)];
                
                await db.ref(`flotillas_gps/${vehiculoId}`).update({
                    lat: newLat,
                    lng: newLng,
                    velocidad: velocidad,
                    direccion: direccion,
                    activo: velocidad > 0,
                    timestamp: Date.now(),
                    ultimo_update: new Date().toLocaleTimeString('es-DO')
                });
            }
            
            console.log('📍 GPS simulado actualizado');
        } catch (error) {
            console.error('Error actualizando GPS simulado:', error);
        }
    }, 30000);
}

// ===============================
// Log de inicio
console.log('✅ PRO-REQUEST v2 cargado completamente');
console.log('📊 Funciones v2 disponibles:');
console.log('- Horarios flexibles 6AM-10PM');
console.log('- Capacidades dinámicas por vehículo');
console.log('- Registro solo por administradores');
console.log('- Choferes con acceso limitado');
console.log('- Exportación con filtros');
console.log('- Gestión de historial');
console.log('- Notificaciones push integradas');

// ===============================
// Cargar choferes disponibles en el selector (se quedó aquí al final como lo tenías)
async function cargarChoferesDisponibles() {
    const select = document.getElementById('choferAsignado');
    select.innerHTML = '<option value="">Seleccione un chofer disponible...</option>';
    
    try {
        const choferesDisponibles = await obtenerChoferesDisponibles();
        
        Object.entries(choferesDisponibles).forEach(([id, chofer]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = `${chofer.nombre} - ${chofer.vehiculo_asignado || 'Sin vehículo'}`;
            select.appendChild(option);
        });
        
        if (Object.keys(choferesDisponibles).length === 0) {
            select.innerHTML = '<option value="">No hay choferes disponibles</option>';
            showAlert('No hay choferes disponibles en este momento', 'warning');
        }
    } catch (error) {
        console.error('Error cargando choferes:', error);
        showAlert('Error al cargar choferes disponibles', 'danger');
    }
}
