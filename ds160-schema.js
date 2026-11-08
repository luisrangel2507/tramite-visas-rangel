// Esquema del formulario DS-160 (solicitud de visa de no inmigrante) en español.
// Fuente única de verdad: lo usa el backend (validación/limpieza) y el frontend
// (render dinámico) vía GET /api/visa/schema.
//
// Campo: { id, label, type, options?, list?, showIf?, na?, optional?, help?, fields?, ... }
//   type: text | textarea | select | date | yesno | tel | email | number | list
//   showIf: { id, eq } | { id, in:[…] } | { id, notIn:[…] }   (o arreglo de condiciones; todas deben cumplirse)
//           `id` se resuelve en el mismo ámbito (sección o elemento de lista).
//   na: texto de la casilla "No aplica" → guarda el valor 'NA'
//   list: nombre de una lista de sugerencias (datalists)
//   type 'list': campo repetible; guarda un arreglo de objetos con `fields`.

const SI_NO = 'yesno';

const t = (id, label, o = {}) => ({ id, label, type: 'text', ...o });
const ta = (id, label, o = {}) => ({ id, label, type: 'textarea', ...o });
const sel = (id, label, options, o = {}) => ({
  id, label, type: 'select',
  options: options.map((x) => (Array.isArray(x) ? { value: x[0], label: x[1] } : { value: x, label: x })),
  ...o,
});
const date = (id, label, o = {}) => ({ id, label, type: 'date', ...o });
const tel = (id, label, o = {}) => ({ id, label, type: 'tel', ...o });
const email = (id, label, o = {}) => ({ id, label, type: 'email', ...o });
const num = (id, label, o = {}) => ({ id, label, type: 'number', ...o });
const country = (id, label, o = {}) => t(id, label, { list: 'countries', ...o });
// Sí/No con campo de explicación opcional que aparece al responder "Sí".
const yn = (id, label, detailLabel, o = {}) => [
  { id, label, type: SI_NO, ...o },
  ...(detailLabel ? [ta(id + 'Detalle', detailLabel, { showIf: [{ id, eq: 'si' }] })] : []),
];
const list = (id, label, itemLabel, addLabel, fields, o = {}) => ({
  id, label, type: 'list', itemLabel, addLabel, fields, max: 10, ...o,
});

const SOCIAL_PLATFORMS = ['Facebook', 'Instagram', 'Twitter / X', 'LinkedIn', 'TikTok', 'YouTube', 'Snapchat',
  'Pinterest', 'Reddit', 'Tumblr', 'Flickr', 'VKontakte', 'Otra'];
const MONTH_UNITS = [['dias', 'Día(s)'], ['semanas', 'Semana(s)'], ['meses', 'Mes(es)'], ['anios', 'Año(s)']];
const US_STATUS = [['ciudadano', 'Ciudadano de EE. UU.'], ['residente', 'Residente permanente (LPR)'],
  ['no_inmigrante', 'No inmigrante'], ['otro', 'Otro / No sé']];

const SECURITY_QUESTIONS = [
  ['enfermedadContagiosa', '¿Tienes una enfermedad transmisible de importancia para la salud pública (chancroide, gonorrea, granuloma inguinal, lepra infecciosa, linfogranuloma venéreo, sífilis en etapa infecciosa, tuberculosis activa u otras que determine el Departamento de Salud de EE. UU.)?'],
  ['trastornoMentalFisico', '¿Tienes algún trastorno mental o físico que represente o pueda representar una amenaza para la seguridad o el bienestar tuyo o de otros?'],
  ['adiccionDrogas', '¿Eres o has sido alguna vez adicto o abusador de drogas?'],
  ['arrestado', '¿Alguna vez has sido arrestado o condenado por algún delito, aunque hayas recibido indulto, amnistía u otra medida similar?'],
  ['sustanciasControladas', '¿Alguna vez has violado, o conspirado para violar, alguna ley relacionada con sustancias controladas?'],
  ['prostitucion', '¿Vas a EE. UU. para ejercer la prostitución o el vicio comercializado ilegal, o has participado en prostitución o proxenetismo en los últimos 10 años?'],
  ['lavadoDinero', '¿Has estado involucrado, o buscas involucrarte, en lavado de dinero?'],
  ['traficoPersonas', '¿Has cometido o conspirado para cometer un delito de trata de personas en EE. UU. o fuera de él?'],
  ['familiarTrafico', '¿Eres cónyuge, hijo o hija de una persona que cometió o conspiró para cometer trata de personas y, en los últimos cinco años, te beneficiaste a sabiendas de esas actividades?'],
  ['ayudoTrafico', '¿Has ayudado, instigado, asistido o colaborado a sabiendas con una persona que cometió o conspiró para cometer un delito grave de trata de personas?'],
  ['espionaje', '¿Buscas realizar espionaje, sabotaje, violaciones de control de exportaciones o cualquier otra actividad ilegal mientras estés en EE. UU.?'],
  ['terrorismo', '¿Buscas realizar actividades terroristas mientras estés en EE. UU., o has participado alguna vez en actividades terroristas?'],
  ['apoyoTerrorismo', '¿Has proporcionado alguna vez, o piensas proporcionar, ayuda financiera u otro tipo de apoyo a terroristas u organizaciones terroristas?'],
  ['miembroTerrorista', '¿Eres miembro o representante de una organización terrorista?'],
  ['familiarTerrorista', '¿Eres cónyuge, hijo o hija de una persona que ha participado en actividades terroristas, incluido el apoyo financiero, en los últimos cinco años?'],
  ['genocidio', '¿Has ordenado, incitado, cometido, ayudado o participado de cualquier otra forma en un genocidio?'],
  ['tortura', '¿Has cometido, ordenado, incitado, ayudado o participado de cualquier otra forma en actos de tortura?'],
  ['ejecuciones', '¿Has cometido, ordenado, incitado, ayudado o participado en ejecuciones extrajudiciales, asesinatos políticos u otros actos de violencia?'],
  ['ninosSoldado', '¿Has participado en el reclutamiento o el uso de niños soldado?'],
  ['libertadReligiosa', '¿Has sido, como funcionario de gobierno, responsable o ejecutor directo de violaciones particularmente graves a la libertad religiosa?'],
  ['controlPoblacion', '¿Has estado directamente involucrado en el establecimiento o la aplicación de controles de población que obliguen a una mujer a abortar contra su voluntad o a una persona a someterse a esterilización contra su libre voluntad?'],
  ['trasplanteOrganos', '¿Has estado directamente involucrado en el trasplante coercitivo de órganos o tejido corporal?'],
  ['fraudeMigratorio', '¿Has buscado obtener o ayudar a otros a obtener una visa, entrada a EE. UU. o cualquier otro beneficio migratorio mediante fraude o declaración falsa deliberada u otros medios ilegales?'],
  ['deportado', '¿Has sido removido o deportado de algún país?'],
  ['custodiaMenor', '¿Has retenido la custodia de un menor ciudadano de EE. UU. fuera del país, a una persona a quien un tribunal de EE. UU. otorgó la custodia legal?'],
  ['votoIlegal', '¿Has votado en EE. UU. violando alguna ley o reglamento?'],
  ['renunciaCiudadania', '¿Has renunciado a la ciudadanía estadounidense con el fin de evadir impuestos?'],
];

const SECTIONS = [
  {
    id: 'personal',
    title: 'Datos personales',
    intro: 'Escribe tus datos exactamente como aparecen en tu pasaporte.',
    fields: [
      t('apellidos', 'Apellido(s)'),
      t('nombres', 'Nombre(s)'),
      t('nombreNativo', 'Nombre completo en tu idioma nativo', { na: 'No aplica / no disponible', help: 'Normalmente es el mismo nombre completo.' }),
      ...yn('otrosNombres', '¿Has usado otros nombres (de soltera/o, alias, religioso, profesional, etc.)?'),
      list('otrosNombresLista', 'Otros nombres usados', 'Nombre', 'Agregar otro nombre', [
        t('apellidos', 'Apellido(s)'), t('nombres', 'Nombre(s)'),
      ], { showIf: [{ id: 'otrosNombres', eq: 'si' }] }),
      ...yn('telecode', '¿Usas un código telegráfico (telecode) para tu nombre?', 'Escribe el código y el nombre que representa', { help: 'Casi siempre la respuesta es "No".' }),
      sel('sexo', 'Sexo', [['F', 'Femenino'], ['M', 'Masculino']]),
      sel('estadoCivil', 'Estado civil', [
        ['soltero', 'Soltero(a)'], ['casado', 'Casado(a)'], ['union_libre', 'Unión libre'],
        ['union_civil', 'Unión civil / pareja doméstica'], ['separado', 'Legalmente separado(a)'],
        ['viudo', 'Viudo(a)'], ['divorciado', 'Divorciado(a)'], ['otro', 'Otro'],
      ]),
      ta('estadoCivilOtro', 'Explica tu estado civil', { showIf: [{ id: 'estadoCivil', eq: 'otro' }] }),
      // Cónyuge actual / fallecido
      t('conyugeApellidos', 'Apellido(s) de tu cónyuge o pareja', { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado', 'viudo'] }] }),
      t('conyugeNombres', 'Nombre(s) de tu cónyuge o pareja', { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado', 'viudo'] }] }),
      date('conyugeFechaNac', 'Fecha de nacimiento de tu cónyuge o pareja', { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado', 'viudo'] }] }),
      country('conyugeNacionalidad', 'Nacionalidad de tu cónyuge o pareja', { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado', 'viudo'] }] }),
      t('conyugeCiudadNac', 'Ciudad de nacimiento de tu cónyuge o pareja', { na: 'Desconocida', showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado', 'viudo'] }] }),
      country('conyugePaisNac', 'País de nacimiento de tu cónyuge o pareja', { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado', 'viudo'] }] }),
      ...yn('conyugeMismoDomicilio', '¿Tu cónyuge o pareja vive en tu mismo domicilio?', null, { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado'] }] }),
      t('conyugeDomicilio', 'Domicilio de tu cónyuge o pareja (calle, número, ciudad, estado, CP, país)', { showIf: [{ id: 'estadoCivil', in: ['casado', 'union_libre', 'union_civil', 'separado'] }, { id: 'conyugeMismoDomicilio', eq: 'no' }] }),
      // Ex cónyuges
      list('exConyuges', 'Ex cónyuges', 'Ex cónyuge', 'Agregar otro ex cónyuge', [
        t('apellidos', 'Apellido(s)'), t('nombres', 'Nombre(s)'),
        date('fechaNac', 'Fecha de nacimiento'), country('nacionalidad', 'Nacionalidad'),
        t('ciudadNac', 'Ciudad de nacimiento', { na: 'Desconocida' }), country('paisNac', 'País de nacimiento'),
        date('fechaMatrimonio', 'Fecha del matrimonio'), date('fechaFin', 'Fecha en que terminó el matrimonio'),
        t('motivoFin', 'Motivo por el que terminó el matrimonio'), country('paisFin', 'País donde terminó el matrimonio'),
      ], { showIf: [{ id: 'estadoCivil', eq: 'divorciado' }] }),
      date('fechaNacimiento', 'Fecha de nacimiento'),
      t('ciudadNacimiento', 'Ciudad de nacimiento'),
      t('estadoNacimiento', 'Estado / provincia de nacimiento', { list: 'estadosMx', na: 'No aplica' }),
      country('paisNacimiento', 'País de nacimiento'),
      country('nacionalidad', 'País / región de origen (nacionalidad)'),
      ...yn('otraNacionalidad', '¿Tienes o has tenido alguna otra nacionalidad además de la indicada arriba?'),
      list('otrasNacionalidades', 'Otras nacionalidades', 'Nacionalidad', 'Agregar otra nacionalidad', [
        country('pais', 'País / región'),
        { id: 'tienePasaporte', label: '¿Tienes pasaporte de ese país?', type: SI_NO },
        t('numeroPasaporte', 'Número de pasaporte de ese país', { showIf: [{ id: 'tienePasaporte', eq: 'si' }] }),
      ], { showIf: [{ id: 'otraNacionalidad', eq: 'si' }] }),
      ...yn('residentePermanenteOtro', '¿Eres residente permanente de un país o región distinto a tu nacionalidad?'),
      list('residenciasPermanentes', 'Residencias permanentes', 'País', 'Agregar otro país', [
        country('pais', 'País / región'),
      ], { showIf: [{ id: 'residentePermanenteOtro', eq: 'si' }] }),
      t('idNacional', 'Número de identificación nacional', { na: 'No aplica', help: 'En México normalmente es la CURP. Si no aplica, marca la casilla.' }),
      t('ssn', 'Número de Seguro Social de EE. UU.', { na: 'No aplica' }),
      t('taxId', 'Número de contribuyente (ITIN) de EE. UU.', { na: 'No aplica' }),
    ],
  },
  {
    id: 'contacto',
    title: 'Domicilio, teléfonos y correo',
    intro: 'Dónde vives y cómo localizarte. Incluye tus redes sociales de los últimos 5 años.',
    fields: [
      t('calle', 'Domicilio (calle, número, colonia)'),
      t('ciudad', 'Ciudad'),
      t('estado', 'Estado / provincia', { list: 'estadosMx' }),
      t('cp', 'Código postal'),
      country('pais', 'País / región'),
      ...yn('mismoDomicilioPostal', '¿Tu domicilio postal (de correspondencia) es el mismo que tu domicilio?'),
      t('postalCalle', 'Domicilio postal (calle y número)', { showIf: [{ id: 'mismoDomicilioPostal', eq: 'no' }] }),
      t('postalCiudad', 'Ciudad', { showIf: [{ id: 'mismoDomicilioPostal', eq: 'no' }] }),
      t('postalEstado', 'Estado / provincia', { list: 'estadosMx', showIf: [{ id: 'mismoDomicilioPostal', eq: 'no' }] }),
      t('postalCp', 'Código postal', { showIf: [{ id: 'mismoDomicilioPostal', eq: 'no' }] }),
      country('postalPais', 'País / región', { showIf: [{ id: 'mismoDomicilioPostal', eq: 'no' }] }),
      tel('telPrincipal', 'Teléfono principal (con lada)'),
      tel('telSecundario', 'Teléfono secundario', { na: 'No aplica' }),
      tel('telTrabajo', 'Teléfono del trabajo', { na: 'No aplica' }),
      ...yn('otrosTelefonos', '¿Has usado otros números de teléfono en los últimos 5 años?'),
      list('otrosTelefonosLista', 'Otros teléfonos', 'Teléfono', 'Agregar otro teléfono', [
        tel('numero', 'Número de teléfono'),
      ], { showIf: [{ id: 'otrosTelefonos', eq: 'si' }] }),
      email('correo', 'Correo electrónico'),
      ...yn('otrosCorreos', '¿Has usado otros correos electrónicos en los últimos 5 años?'),
      list('otrosCorreosLista', 'Otros correos', 'Correo', 'Agregar otro correo', [
        email('correo', 'Correo electrónico'),
      ], { showIf: [{ id: 'otrosCorreos', eq: 'si' }] }),
      ...yn('tieneRedes', '¿Tienes presencia en redes sociales?'),
      list('redes', 'Redes sociales', 'Red social', 'Agregar otra red social', [
        sel('plataforma', 'Plataforma', SOCIAL_PLATFORMS),
        t('usuario', 'Usuario / identificador'),
      ], { showIf: [{ id: 'tieneRedes', eq: 'si' }] }),
      ...yn('otrasRedes', '¿Tienes presencia en alguna otra plataforma o sitio web donde compartas contenido?'),
      list('otrasRedesLista', 'Otras plataformas', 'Plataforma', 'Agregar otra plataforma', [
        t('plataforma', 'Nombre de la plataforma'),
        t('usuario', 'Usuario / identificador'),
      ], { showIf: [{ id: 'otrasRedes', eq: 'si' }] }),
    ],
  },
  {
    id: 'pasaporte',
    title: 'Pasaporte',
    intro: 'Ten tu pasaporte a la mano.',
    fields: [
      sel('pasaporteTipo', 'Tipo de pasaporte', [['regular', 'Regular'], ['oficial', 'Oficial'], ['diplomatico', 'Diplomático'], ['laissez', 'Laissez-passer'], ['otro', 'Otro']]),
      t('pasaporteNumero', 'Número de pasaporte'),
      t('pasaporteLibreta', 'Número de libreta del pasaporte', { na: 'No aplica' }),
      country('pasaportePaisEmisor', 'País / autoridad que expidió el pasaporte'),
      t('pasaporteCiudad', 'Ciudad donde se expidió'),
      t('pasaporteEstado', 'Estado / provincia donde se expidió', { list: 'estadosMx' }),
      country('pasaportePaisExpedicion', 'País / región donde se expidió'),
      date('pasaporteExpedicion', 'Fecha de expedición'),
      date('pasaporteVencimiento', 'Fecha de vencimiento', { na: 'No vence' }),
      ...yn('pasaporteExtraviado', '¿Alguna vez has perdido un pasaporte o te lo han robado?'),
      list('pasaportesExtraviados', 'Pasaportes perdidos o robados', 'Pasaporte', 'Agregar otro pasaporte', [
        t('numero', 'Número de pasaporte', { na: 'No lo sé' }),
        country('pais', 'País que lo expidió'),
        ta('explicacion', 'Explica qué sucedió'),
      ], { showIf: [{ id: 'pasaporteExtraviado', eq: 'si' }] }),
    ],
  },
  {
    id: 'viaje',
    title: 'Viaje a Estados Unidos',
    fields: [
      sel('visaTipo', 'Propósito del viaje', [
        ['B1B2', 'Negocios o turismo (B1/B2)'], ['B1', 'Negocios (B1)'], ['B2', 'Turismo / placer (B2)'],
        ['C', 'Tránsito (C)'], ['F_M', 'Estudiante (F/M)'], ['J', 'Intercambio (J)'], ['H', 'Trabajo temporal (H)'], ['otro', 'Otro'],
      ]),
      t('visaTipoOtro', 'Especifica el propósito', { showIf: [{ id: 'visaTipo', eq: 'otro' }] }),
      ...yn('planesEspecificos', '¿Ya tienes planes específicos de viaje?'),
      // Con planes
      date('fechaLlegada', 'Fecha de llegada a EE. UU.', { showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      t('vueloLlegada', 'Número de vuelo de llegada', { optional: true, showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      t('ciudadLlegada', 'Ciudad de llegada', { showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      date('fechaSalida', 'Fecha de salida de EE. UU.', { showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      t('vueloSalida', 'Número de vuelo de salida', { optional: true, showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      t('ciudadSalida', 'Ciudad de salida', { showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      ta('lugaresVisitar', 'Lugares que visitarás en EE. UU.', { showIf: [{ id: 'planesEspecificos', eq: 'si' }] }),
      // Sin planes
      date('fechaLlegadaEstimada', 'Fecha estimada de llegada', { showIf: [{ id: 'planesEspecificos', eq: 'no' }] }),
      num('estanciaNumero', 'Tiempo de estancia previsto', { showIf: [{ id: 'planesEspecificos', eq: 'no' }] }),
      sel('estanciaUnidad', 'Unidad de tiempo', MONTH_UNITS, { showIf: [{ id: 'planesEspecificos', eq: 'no' }] }),
      t('hospedajeCalle', 'Dirección donde te hospedarás en EE. UU. (línea 1)'),
      t('hospedajeCalle2', 'Dirección (línea 2)', { optional: true }),
      t('hospedajeCiudad', 'Ciudad'),
      t('hospedajeEstado', 'Estado', { list: 'estadosUs' }),
      t('hospedajeCp', 'Código postal (ZIP)'),
      sel('quienPaga', '¿Quién pagará tu viaje?', [
        ['yo', 'Yo mismo(a)'], ['otra_persona', 'Otra persona'], ['empleador_actual', 'Mi empleador actual'],
        ['empleador_eeuu', 'Empleador en EE. UU.'], ['organizacion', 'Otra empresa u organización'],
      ]),
      t('pagadorNombre', 'Nombre de la persona u organización que paga', { showIf: [{ id: 'quienPaga', notIn: ['yo'] }] }),
      tel('pagadorTel', 'Teléfono', { showIf: [{ id: 'quienPaga', notIn: ['yo'] }] }),
      email('pagadorCorreo', 'Correo electrónico', { na: 'No aplica', showIf: [{ id: 'quienPaga', notIn: ['yo'] }] }),
      t('pagadorRelacion', 'Relación contigo', { showIf: [{ id: 'quienPaga', notIn: ['yo'] }] }),
      t('pagadorDomicilio', 'Domicilio de quien paga (o escribe "igual al mío")', { showIf: [{ id: 'quienPaga', notIn: ['yo'] }] }),
      ...yn('viajaConOtros', '¿Viajan otras personas contigo?'),
      ...yn('viajaEnGrupo', '¿Viajas como parte de un grupo u organización?', null, { showIf: [{ id: 'viajaConOtros', eq: 'si' }] }),
      t('nombreGrupo', 'Nombre del grupo u organización', { showIf: [{ id: 'viajaConOtros', eq: 'si' }, { id: 'viajaEnGrupo', eq: 'si' }] }),
      list('acompanantes', 'Personas que viajan contigo', 'Acompañante', 'Agregar otro acompañante', [
        t('apellidos', 'Apellido(s)'), t('nombres', 'Nombre(s)'),
        sel('relacion', 'Relación contigo', ['Padre/Madre', 'Cónyuge', 'Hijo(a)', 'Hermano(a)', 'Otro familiar', 'Amigo(a)', 'Socio de negocios', 'Otro']),
      ], { showIf: [{ id: 'viajaConOtros', eq: 'si' }, { id: 'viajaEnGrupo', eq: 'no' }] }),
      ...yn('haEstadoEEUU', '¿Has estado alguna vez en Estados Unidos?'),
      list('visitasPrevias', 'Visitas previas a EE. UU.', 'Visita', 'Agregar otra visita', [
        date('fechaLlegada', 'Fecha de llegada'),
        num('estanciaNumero', 'Duración de la estancia'),
        sel('estanciaUnidad', 'Unidad', MONTH_UNITS),
      ], { max: 5, showIf: [{ id: 'haEstadoEEUU', eq: 'si' }] }),
      ...yn('licenciaEEUU', '¿Has tenido licencia de conducir de EE. UU.?', null, { showIf: [{ id: 'haEstadoEEUU', eq: 'si' }] }),
      list('licencias', 'Licencias de conducir de EE. UU.', 'Licencia', 'Agregar otra licencia', [
        t('numero', 'Número de licencia', { na: 'No lo sé' }), t('estado', 'Estado que la expidió', { list: 'estadosUs' }),
      ], { showIf: [{ id: 'haEstadoEEUU', eq: 'si' }, { id: 'licenciaEEUU', eq: 'si' }] }),
      ...yn('visaEmitida', '¿Alguna vez te han expedido una visa de EE. UU.?'),
      date('visaUltimaFecha', 'Fecha de expedición de tu última visa', { showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      t('visaNumero', 'Número de esa visa', { na: 'No lo sé', showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      ...yn('visaMismoTipo', '¿Solicitas el mismo tipo de visa?', null, { showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      ...yn('visaMismoPais', '¿Solicitas la visa en el mismo país donde se expidió la anterior y es tu país de residencia?', null, { showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      ...yn('visaHuellas', '¿Te tomaron las diez huellas dactilares?', null, { showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      ...yn('visaPerdida', '¿Tu visa fue perdida o robada alguna vez?', 'Año y explicación', { showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      ...yn('visaCancelada', '¿Tu visa fue cancelada o revocada alguna vez?', 'Explica', { showIf: [{ id: 'visaEmitida', eq: 'si' }] }),
      ...yn('visaNegada', '¿Alguna vez te han negado una visa de EE. UU., te han negado la admisión a EE. UU. o has retirado tu solicitud de admisión en un puerto de entrada?', 'Explica cuándo, dónde y por qué'),
      ...yn('peticionInmigrante', '¿Alguien ha presentado alguna vez una petición de inmigrante a tu favor ante el Servicio de Ciudadanía e Inmigración de EE. UU. (USCIS)?', 'Explica'),
    ],
  },
  {
    id: 'contactoEEUU',
    title: 'Contacto en Estados Unidos',
    intro: 'Persona u organización en EE. UU. (puede ser el hotel donde te hospedarás).',
    fields: [
      t('contactoNombre', 'Nombre de la persona de contacto', { na: 'No conozco a nadie' }),
      t('contactoOrganizacion', 'Nombre de la organización (p. ej., el hotel)', { na: 'No aplica' }),
      sel('contactoRelacion', 'Relación contigo', [
        ['pariente', 'Pariente'], ['conyuge', 'Cónyuge'], ['amigo', 'Amigo(a)'], ['socio', 'Socio de negocios'],
        ['empleador', 'Empleador'], ['escuela', 'Funcionario escolar'], ['otro', 'Otro'],
      ]),
      t('contactoCalle', 'Domicilio del contacto (línea 1)'),
      t('contactoCalle2', 'Domicilio (línea 2)', { optional: true }),
      t('contactoCiudad', 'Ciudad'),
      t('contactoEstado', 'Estado', { list: 'estadosUs' }),
      t('contactoCp', 'Código postal (ZIP)'),
      tel('contactoTel', 'Teléfono'),
      email('contactoCorreo', 'Correo electrónico', { na: 'No aplica' }),
    ],
  },
  {
    id: 'familia',
    title: 'Familia',
    fields: [
      t('padreApellidos', 'Apellido(s) de tu padre', { na: 'No lo sé' }),
      t('padreNombres', 'Nombre(s) de tu padre', { na: 'No lo sé' }),
      date('padreFechaNac', 'Fecha de nacimiento de tu padre', { na: 'No la sé' }),
      ...yn('padreEnEEUU', '¿Tu padre está en EE. UU.?'),
      sel('padreEstatus', 'Estatus de tu padre en EE. UU.', US_STATUS, { showIf: [{ id: 'padreEnEEUU', eq: 'si' }] }),
      t('madreApellidos', 'Apellido(s) de tu madre', { na: 'No lo sé' }),
      t('madreNombres', 'Nombre(s) de tu madre', { na: 'No lo sé' }),
      date('madreFechaNac', 'Fecha de nacimiento de tu madre', { na: 'No la sé' }),
      ...yn('madreEnEEUU', '¿Tu madre está en EE. UU.?'),
      sel('madreEstatus', 'Estatus de tu madre en EE. UU.', US_STATUS, { showIf: [{ id: 'madreEnEEUU', eq: 'si' }] }),
      ...yn('parientesInmediatos', '¿Tienes parientes inmediatos en EE. UU. (sin contar a tus padres)? Cónyuge, prometido(a), hijos o hermanos.'),
      list('parientesLista', 'Parientes inmediatos en EE. UU.', 'Pariente', 'Agregar otro pariente', [
        t('apellidos', 'Apellido(s)'), t('nombres', 'Nombre(s)'),
        sel('parentesco', 'Parentesco', ['Cónyuge', 'Prometido(a)', 'Hijo(a)', 'Hermano(a)']),
        sel('estatus', 'Estatus en EE. UU.', US_STATUS),
      ], { showIf: [{ id: 'parientesInmediatos', eq: 'si' }] }),
      ...yn('otrosParientes', '¿Tienes algún otro pariente en Estados Unidos?'),
    ],
  },
  {
    id: 'trabajo',
    title: 'Trabajo y estudios',
    fields: [
      sel('ocupacion', 'Ocupación principal', [
        ['agricultura', 'Agricultura'], ['artista', 'Artista / artes escénicas'], ['negocios', 'Negocios'],
        ['comunicaciones', 'Comunicaciones'], ['computacion', 'Computación / sistemas'], ['culinaria', 'Gastronomía / alimentos'],
        ['educacion', 'Educación'], ['ingenieria', 'Ingeniería'], ['gobierno', 'Gobierno'], ['hogar', 'Hogar'],
        ['legal', 'Profesión legal'], ['salud', 'Médica / salud'], ['militar', 'Militar'], ['ciencias_naturales', 'Ciencias naturales'],
        ['desempleado', 'Sin empleo'], ['ciencias_fisicas', 'Ciencias físicas'], ['religiosa', 'Vocación religiosa'],
        ['investigacion', 'Investigación'], ['jubilado', 'Jubilado(a)'], ['ciencias_sociales', 'Ciencias sociales'],
        ['estudiante', 'Estudiante'], ['otra', 'Otra'],
      ]),
      t('ocupacionOtra', 'Especifica tu ocupación', { showIf: [{ id: 'ocupacion', eq: 'otra' }] }),
      ta('ocupacionExplicacion', 'Explica cómo te mantienes (ingresos, apoyo familiar, pensión, etc.)', { showIf: [{ id: 'ocupacion', in: ['desempleado', 'jubilado', 'hogar'] }] }),
      t('empleadorNombre', 'Nombre de tu empleador o escuela actual', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      t('empleadorCalle', 'Domicilio (calle y número)', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      t('empleadorCiudad', 'Ciudad', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      t('empleadorEstado', 'Estado / provincia', { list: 'estadosMx', showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      t('empleadorCp', 'Código postal', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      country('empleadorPais', 'País / región', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      tel('empleadorTel', 'Teléfono del trabajo o escuela', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      t('empleadorSalario', 'Salario mensual en moneda local (si trabajas)', { optional: true, showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      ta('empleadorFunciones', 'Describe brevemente tus funciones', { showIf: [{ id: 'ocupacion', notIn: ['desempleado', 'jubilado', 'hogar'] }] }),
      ...yn('empleoPrevio', '¿Has tenido empleos anteriores?'),
      list('empleosPrevios', 'Empleos anteriores', 'Empleo', 'Agregar otro empleo', [
        t('empleador', 'Nombre del empleador'),
        t('calle', 'Domicilio (calle y número)'), t('ciudad', 'Ciudad'),
        t('estado', 'Estado / provincia', { list: 'estadosMx' }), t('cp', 'Código postal'),
        country('pais', 'País / región'), tel('tel', 'Teléfono'),
        t('puesto', 'Puesto'),
        t('supApellidos', 'Apellido(s) de tu supervisor', { na: 'No lo sé' }),
        t('supNombres', 'Nombre(s) de tu supervisor', { na: 'No lo sé' }),
        date('desde', 'Fecha de inicio'), date('hasta', 'Fecha de término'),
        ta('funciones', 'Describe brevemente tus funciones'),
      ], { showIf: [{ id: 'empleoPrevio', eq: 'si' }] }),
      ...yn('estudios', '¿Has estudiado en alguna institución de nivel secundaria (preparatoria) o superior?'),
      list('estudiosLista', 'Instituciones educativas', 'Institución', 'Agregar otra institución', [
        t('institucion', 'Nombre de la institución'),
        t('calle', 'Domicilio (calle y número)'), t('ciudad', 'Ciudad'),
        t('estado', 'Estado / provincia', { list: 'estadosMx' }), t('cp', 'Código postal'),
        country('pais', 'País / región'),
        t('carrera', 'Carrera o curso de estudio'),
        date('desde', 'Fecha de inicio'), date('hasta', 'Fecha de término'),
      ], { showIf: [{ id: 'estudios', eq: 'si' }] }),
    ],
  },
  {
    id: 'adicional',
    title: 'Información adicional',
    fields: [
      ...yn('clan', '¿Perteneces a un clan o tribu?'),
      t('clanNombre', 'Nombre del clan o tribu', { showIf: [{ id: 'clan', eq: 'si' }] }),
      list('idiomas', 'Idiomas que hablas', 'Idioma', 'Agregar otro idioma', [
        t('idioma', 'Idioma', { list: 'idiomasSugeridos' }),
      ], { max: 10, min: 1 }),
      ...yn('viajesPaises', '¿Has viajado a otros países en los últimos cinco años?'),
      list('paisesVisitados', 'Países visitados', 'País', 'Agregar otro país', [
        country('pais', 'País / región'),
      ], { max: 20, showIf: [{ id: 'viajesPaises', eq: 'si' }] }),
      ...yn('organizaciones', '¿Has pertenecido, contribuido o trabajado para alguna organización profesional, social o de beneficencia?'),
      list('organizacionesLista', 'Organizaciones', 'Organización', 'Agregar otra organización', [
        t('nombre', 'Nombre de la organización'),
      ], { showIf: [{ id: 'organizaciones', eq: 'si' }] }),
      ...yn('habilidadesEspeciales', '¿Tienes habilidades o entrenamiento especializado en armas de fuego, explosivos, o experiencia nuclear, biológica o química?', 'Explica'),
      ...yn('servicioMilitar', '¿Has servido en el ejército?'),
      list('servicioMilitarLista', 'Servicio militar', 'Servicio', 'Agregar otro servicio', [
        country('pais', 'País / región'), t('rama', 'Rama del servicio'), t('rango', 'Rango / posición'),
        t('especialidad', 'Especialidad militar'), date('desde', 'Fecha de inicio'), date('hasta', 'Fecha de término'),
      ], { showIf: [{ id: 'servicioMilitar', eq: 'si' }] }),
      ...yn('paramilitar', '¿Has servido, sido miembro o estado involucrado con una unidad paramilitar, de vigilantes, grupo rebelde, guerrillero u organización insurgente?', 'Explica'),
    ],
  },
  {
    id: 'seguridad',
    title: 'Seguridad y antecedentes',
    intro: 'Responde con total honestidad. Si respondes "Sí" a alguna pregunta, explica brevemente.',
    fields: SECURITY_QUESTIONS.flatMap(([id, label]) => yn('seg_' + id, label, 'Explica')),
  },
];

const COUNTRIES = ('Afganistán|Albania|Alemania|Andorra|Angola|Antigua y Barbuda|Arabia Saudita|Argelia|Argentina|Armenia|Australia|Austria|Azerbaiyán|Bahamas|Bangladés|Barbados|Baréin|Bélgica|Belice|Benín|Bielorrusia|Birmania (Myanmar)|Bolivia|Bosnia y Herzegovina|Botsuana|Brasil|Brunéi|Bulgaria|Burkina Faso|Burundi|Bután|Cabo Verde|Camboya|Camerún|Canadá|Catar|Chad|Chile|China|Chipre|Colombia|Comoras|Corea del Norte|Corea del Sur|Costa de Marfil|Costa Rica|Croacia|Cuba|Dinamarca|Dominica|Ecuador|Egipto|El Salvador|Emiratos Árabes Unidos|Eritrea|Eslovaquia|Eslovenia|España|Estados Unidos|Estonia|Esuatini|Etiopía|Filipinas|Finlandia|Fiyi|Francia|Gabón|Gambia|Georgia|Ghana|Granada|Grecia|Guatemala|Guinea|Guinea Ecuatorial|Guinea-Bisáu|Guyana|Haití|Honduras|Hong Kong|Hungría|India|Indonesia|Irak|Irán|Irlanda|Islandia|Islas Marshall|Islas Salomón|Israel|Italia|Jamaica|Japón|Jordania|Kazajistán|Kenia|Kirguistán|Kiribati|Kosovo|Kuwait|Laos|Lesoto|Letonia|Líbano|Liberia|Libia|Liechtenstein|Lituania|Luxemburgo|Macao|Macedonia del Norte|Madagascar|Malasia|Malaui|Maldivas|Malí|Malta|Marruecos|Mauricio|Mauritania|México|Micronesia|Moldavia|Mónaco|Mongolia|Montenegro|Mozambique|Namibia|Nauru|Nepal|Nicaragua|Níger|Nigeria|Noruega|Nueva Zelanda|Omán|Países Bajos|Pakistán|Palaos|Palestina|Panamá|Papúa Nueva Guinea|Paraguay|Perú|Polonia|Portugal|Puerto Rico|Reino Unido|República Centroafricana|República Checa|República del Congo|República Democrática del Congo|República Dominicana|Ruanda|Rumania|Rusia|Samoa|San Cristóbal y Nieves|San Marino|San Vicente y las Granadinas|Santa Lucía|Santo Tomé y Príncipe|Senegal|Serbia|Seychelles|Sierra Leona|Singapur|Siria|Somalia|Sri Lanka|Sudáfrica|Sudán|Sudán del Sur|Suecia|Suiza|Surinam|Tailandia|Taiwán|Tanzania|Tayikistán|Timor Oriental|Togo|Tonga|Trinidad y Tobago|Túnez|Turkmenistán|Turquía|Tuvalu|Ucrania|Uganda|Uruguay|Uzbekistán|Vanuatu|Ciudad del Vaticano|Venezuela|Vietnam|Yemen|Yibuti|Zambia|Zimbabue').split('|');

const DATALISTS = {
  countries: COUNTRIES,
  estadosMx: ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Ciudad de México',
    'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos',
    'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco',
    'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'],
  estadosUs: ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Carolina del Norte', 'Carolina del Sur', 'Colorado', 'Connecticut',
    'Dakota del Norte', 'Dakota del Sur', 'Delaware', 'Distrito de Columbia', 'Florida', 'Georgia', 'Hawái', 'Idaho', 'Illinois', 'Indiana',
    'Iowa', 'Kansas', 'Kentucky', 'Luisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Misisipi', 'Misuri', 'Montana',
    'Nebraska', 'Nevada', 'Nueva Hampshire', 'Nueva Jersey', 'Nueva York', 'Nuevo México', 'Ohio', 'Oklahoma', 'Oregón', 'Pensilvania',
    'Rhode Island', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Virginia Occidental', 'Washington', 'Wisconsin', 'Wyoming'],
  idiomasSugeridos: ['Español', 'Inglés', 'Francés', 'Alemán', 'Italiano', 'Portugués', 'Náhuatl', 'Maya', 'Mixteco', 'Zapoteco', 'Otomí'],
};

const STATUS_OPTIONS = [
  { value: 'enlace_enviado', label: 'Enlace enviado', tone: 'neutral' },
  { value: 'formulario_recibido', label: 'Formulario recibido', tone: 'neutral' },
  { value: 'en_revision', label: 'En revisión', tone: 'neutral' },
  { value: 'informacion_pendiente', label: 'Falta información', tone: 'warn' },
  { value: 'listo_para_cita', label: 'Listo para agendar cita', tone: 'good' },
  { value: 'cita_programada', label: 'Cita programada', tone: 'good' },
  { value: 'aprobada', label: 'Visa aprobada', tone: 'good' },
  { value: 'rechazada', label: 'Visa rechazada', tone: 'bad' },
];

const DOCUMENT_CATEGORIES = [
  { value: 'pasaporte', label: 'Pasaporte (escaneo o foto)' },
  { value: 'identificacion', label: 'Identificación oficial' },
  { value: 'visa_anterior', label: 'Visa anterior' },
  { value: 'comprobante_domicilio', label: 'Comprobante de domicilio' },
  { value: 'comprobante_economico', label: 'Comprobante económico / laboral' },
  { value: 'otro', label: 'Otro documento' },
];

module.exports = { SECTIONS, DATALISTS, STATUS_OPTIONS, DOCUMENT_CATEGORIES };
