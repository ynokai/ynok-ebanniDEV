"use strict";

const PORT = process.env.PORT;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = process.env.OPENAI_API_URL;
const TIMEOUT_BORRAR = process.env.TIMEOUT_BORRAR * 1000;
const TIMEOUT_RESPONDER = process.env.TIMEOUT_RESPONDER * 1000;
const TIMEOUT_WATCHDOG = process.env.TIMEOUT_WATCHDOG * 1000;
const MONGO_URL = process.env.MONGO_URL;
const KEY = JSON.parse(process.env.ACCOUNT_JSON);
const GRAPH_API_TOKEN = process.env.GRAPH_API_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const express = require("express");
const body_parser = require("body-parser");
const axios = require("axios");
const fs = require("fs").promises;
const moment = require("moment-timezone");
const { MongoClient, ObjectId } = require("mongodb");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

let _phone_number_id = 412480435276019;

// Definición de esquemas de Mongoose
const Schema = mongoose.Schema;
// Configura strictQuery según lo que prefieras
mongoose.set('strictQuery', false);

// Diccionario para almacenar conversaciones activas
let conversaciones = {};

const Log = Object.freeze({
  Log: 0,
  Error: 1,
});

// actores
const WhoEnum = Object.freeze({
  None: 0,
  User: 1,
  ChatGPT: 2,
  System: 3,
});

// variables
const GPTEnum = Object.freeze({
  NONE: "-",
  LISTAPELUQ: "LISTAPELUQ",
  CONSULTHOR: "CONSULTHOR",
  CENTROID: "CENTROID",
  CANCELACITA: "CANCELACITA",
  SERV: "SERV",
  SPECIALITY: "SPECIALITY",
  GUARDACITA: "GUARDACITA",
  //HORACOMIDA: "HORACOMIDA",
  //BAJAPELUQ: "BAJAPELUQ",
  //CAMBIOHORARIO: "CAMBIOHORARIO",
  MODCITA: "MODCITA",
  SALON: "SALON",
  CENTROINFO: "CENTROINFO",
});

// Definición de esquemas de Mongoose

const servicesSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  serviceName: String,
  duration: String,
  color: String,
  specialities: [Schema.Types.ObjectId],
});

const Services = mongoose.model("services", servicesSchema);

const specialitiesSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  specialityName: String,
});

const Epecialities = mongoose.model("specialities", specialitiesSchema);

const appointmentsSchema = new mongoose.Schema(
  {
    _id: {
      type: Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
    },
    clientName: String,
    clientPhone: String,
    date: String,
    initTime: String,
    finalTime: String,
    userInfo: Schema.Types.ObjectId,
    centerInfo: Schema.Types.ObjectId,
    services: [servicesSchema],
    specialty: Schema.Types.ObjectId,
    createdBy: {
      type: String,
      enum: ["Manual", "WhatsApp"], // Valores permitidos
      default: "WhatsApp", // Valor predeterminado
    },
    status: {
      type: String,
      enum: ["confirmed", "canceled"], // Define los valores permitidos
      default: "confirmed", // Valor predeterminado
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now, // Fecha de creación inicializada automáticamente
    },
  },
  { _id: false }
);

const Appointments = mongoose.model("appointments", appointmentsSchema);

const centersSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  centerName: String,
  address: String,
  userInfo: [Schema.Types.ObjectId],
  phoneNumber: String,
  specialities: [Schema.Types.ObjectId],
});

const Centers = mongoose.model("centers", centersSchema);

const usersSchema = new mongoose.Schema({
  _id: Schema.Types.ObjectId,
  name: String,
  email: String,
  DNI: String,
  phone: String,
  password: String,
  role: String,
  centerInfo: Schema.Types.ObjectId,
  services: [servicesSchema],
  specialities: [Schema.Types.ObjectId],
});

const Users = mongoose.model("users", usersSchema);

const statisticsSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  confirmedAppointments: { type: Number, default: 0 },
  modifiedAppointments: { type: Number, default: 0 },
  canceledAppointments: { type: Number, default: 0 },
  failedOperations: { type: Number, default: 0 },
  interactions: { type: Number, default: 0 },
  feedbackResponses: { type: Number, default: 0 },
  qrScans: { type: Number, default: 0 },
});

const Statistics = mongoose.model("statistics", statisticsSchema);

const metaDataSchema = new mongoose.Schema({
  phoneNumber: String, // Número de teléfono del cliente
  date: { type: Date, default: Date.now },
  centerID: String,
  centerName: String,
  type: String, // Tipo de operación (error o éxito)
  message: String, // Mensaje del error o éxito
  partOfProgram: String, // Parte del programa donde ocurrió el fallo o éxito
});

const MetaData = mongoose.model("metadata", metaDataSchema);

// Define your schema
const surveyResponseSchema = new mongoose.Schema({
  phoneNumber: String,
  opinionFeedback: String,
  improvementFeedback: String,
  citaRadio: String,
  botExistance: String,
  date: { type: Date, default: Date.now },
});

const SurveyResponse = mongoose.model("SurveyResponse", surveyResponseSchema);

const messageSchema = new mongoose.Schema({
  type: { type: String, required: true }, // 'user', 'bot', 'system'
  content: { type: String, required: true }, // Contenido del mensaje
  timestamp: { type: Date, default: Date.now }, // Hora en la que se envió
});

const conversationSchema = new mongoose.Schema({
  from: { type: String, required: true }, // Número de teléfono del cliente
  startTime: { type: Date, default: Date.now }, // Fecha y hora de inicio de la conversación
  endTime: Date, // Fecha y hora de fin de la conversación (opcional)
  messages: [messageSchema], // Array de mensajes con su esquema
});

const chatHistorySchema = new mongoose.Schema({
  from: String, // Número de teléfono del cliente
  conversation: String, // La conversación completa en un solo string
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
});

const ChatHistory = mongoose.model("ChatHistory", chatHistorySchema);

// Función para conectar a la base de datos MongoDB
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URL, { serverSelectionTimeoutMS: 10000 });
  } catch (ex) {
    DoLog(`Error al conectar a MongoDB: ${ex}`, Log.Error);
    process.exit(1);
  }
}

let salones = [];
let salonesList = "";
let servicios = [];
let serviciosList = "";
let especialidades = [];
let especialidadesList = [];
let peluqueros = [];
let peluquerosList = "";

function ObtenerEspecialidades(peluqueroID) {
  let rtn = [];
  for (let peluquero of peluqueros) {
    if (peluquero.peluqueroID == peluqueroID) {
      rtn = peluquero.specialities;
      return rtn;
    }
  }
  return rtn;
}

async function readDB() {
  servicios = [];
  serviciosList = "";
  try {
    let lista = await Services.find({});
    for (let servicio of lista) {
      let specialities = [];
      for (let speciality of servicio.specialities) {
        specialities.push(speciality.toString());
      }
      servicios.push({
        servicioID: servicio._id.toString(),
        servicio: servicio.serviceName,
        duracion: servicio.duration,
        color: servicio.color,
        specialities: specialities,
      });
      serviciosList +=
        servicio._id.toString() +
        ": " +
        servicio.serviceName +
        " (" +
        servicio.duration +
        "), ";
    }
  } catch (ex) {
    DoLog(`Error al listar los servicios: ${ex}`, Log.Error);
    throw ex;
  }

  especialidades = [];
  especialidadesList = "";
  try {
    let lista = await Epecialities.find({});
    for (let especialidad of lista) {
      especialidades.push({
        especialidadID: especialidad._id.toString(),
        name: especialidad.specialityName,
      });
      especialidadesList +=
        especialidad._id.toString() + ": " + especialidad.specialityName + ", ";
    }
  } catch (ex) {
    DoLog(`Error al listar las espècialidades: ${ex}`, Log.Error);
    throw ex;
  }

  peluqueros = [];
  peluquerosList = "";
  try {
    let lista = await Users.find({
      role: "employee",
    });
    for (let peluquero of lista) {
      let specialities = [];
      for (let speciality of peluquero.specialities) {
        specialities.push(speciality.toString());
      }
      let services = [];
      for (let service of peluquero.services) {
        /******************
         *  TODO: cambiar serviceName por ObjectID
         ******************/
        services.push(service.serviceName);
      }
      peluqueros.push({
        peluqueroID: peluquero._id.toString(),
        name: peluquero.name,
        email: peluquero.email,
        dni: peluquero.DNI,
        phone: peluquero.phone,
        salonID: peluquero.centerInfo.toString(),
        services: services,
        specialities: specialities,
      });
      peluquerosList += peluquero._id.toString() + ": " + peluquero.name + ", ";
    }
  } catch (ex) {
    DoLog(`Error al listar los peluqueros: ${ex}`, Log.Error);
    throw ex;
  }

  salones = [];
  salonesList = "";
  try {
    let lista = await Centers.find({});
    for (let salon of lista) {
      let users = [];
      for (let user of salon.userInfo) {
        let peluqueroID = user.toString();
        users.push(peluqueroID);
      }
      let specialities = [];
      for (let speciality of salon.specialities) {
        specialities.push(speciality.toString());
      }
      salones.push({
        salonID: salon._id.toString(),
        nombre: salon.centerName,
        address: salon.address,
        phoneNumber: salon.phoneNumber,
        users: users,
        specialities: specialities,
      });
      salonesList += salon._id.toString() + ": " + salon.centerName + ",";
    }
  } catch (ex) {
    DoLog(`Error al listar los centros: ${ex}`, Log.Error);
    throw ex;
  }
}

// Contexto de identidad para ChatGPT
let IDENTITY_CONTEXT = `Eres un recepcionista de REAL de Ébanni Peluqueros. Tu función es asistir al cliente en un entorno REAL para pedir una cita o resolver cualquier duda acerca del salón y los servicios ofrecidos, ademas de reservar la hora de descanso a los peluqueros. No puedes mentir. El sistema funciona a través de una conversación en whatsapp. El cliente manda un mensaje, te llega a ti y tu respuesta se le envía a él. Si el cliente no te manda un mensaje tú no le puedes contestar ni puedes hacer nada. Salvo en los casos en los que mandes mensajes de sistema. Los mensajes de sistema no se envían al cliente, los lee el sistema y te envía la información que requiere cada mensaje del sistema. Al recibir tú un mensaje del sistema puedes contestar al cliente con la información que te faltaba.
El horario de las peluquerías es de lunes a sábado desde 10 de la mañana a 22 de la noche, la ultima cita se podrá agendar a las 21:30h.
En el mes de diciembre, los domingos los salones están abiertos.
Cuando un cliente te diga el dia al que quuiere acudir al centro, verifica que dia de la semana es, si es domingo, diles que estamos cerrados.
Tenemos peluquerías en los siguientes salones: El Corte Inglés de Nervión Señora (Sevilla);  El Corte Inglés de Nervión Caballeros (Sevilla); El Corte Inglés Plaza del Duque (Sevilla); El Corte Inglés de San Juan de Aznalfarache (Sevilla); El Corte Inglés de Sevilla Este (Sevilla); CC La Vaguada (Madrid); CC Plaza Éboli (Pinto, Madrid); CC Plaza Norte 2 (San Sebastián de los Reyes, Madrid); CC El Rosal (Ponferrada); CC Intu Aturias (Asturias); El Corte Inglés de Pozuelo (Madrid); El corte inglés de Palma (Mallorca), aunque solo se puede pedir cita en Nervion Caballeros y Nervion Señoras, Duque y Sevilla Este. 
Presentate como el recepcionista de Peluquerías Ébanni.
Cuando un cliente te de las gracias, dile gracias a ti y el resto del mensaje.
Si piden directamente cita con un peluquero, verifica primero el centro al que quieren acudir.
Puedes hablar todos los idiomas, responde al cliente en el idioma en el que te hablan.

Los tratamientos capilares que ofrecemos son: anticaida, anticaspa, hidratante, nutritivo y más. Cuando un cliente quiera solicitar cualquier tratamiento capilar, procesalo como tratamiento.
Si el cliente pide precios, comunicale que los precios no pueden ser hablados por telefono.
La cita siempre está disponible salvo que el sistema de citas te diga lo contrario. Los mensajes con comandos no se envían al cliente. Al recibir un mensaje del sistema puedes contestar al cliente con la información que te faltaba.
Pregunta si quieren pedir cita con un peluquero específico. Si dicen que se le asigne cualquier peluquero disponible, en la confirmacion escribe el nombre del peluquero asignado y "(asignado aleatoriamente)". 
Antes de confirmar la cita, pregunta por el nombre del cliente. 
Siempre tienen que decirte qué día quieren, no pueden dejarlo a tu elección, no pueden decirte el más cercano o el primero.
Cuando el sistema te comunique los horarios disponibles, diselos al cliente con todas las opciones que te da.

No pongas corchetes de estos "[]", solo los usa el sistema. Los mensajes entre <estos corchetes> debes ignorarlos. Máximo cada mensaje que hagas puede tener 599 caracteres. Si el sistema da un fallo, sigue las instrucciones del sistema.
Estos son los comandos que el sistema es capaz de procesar y deben ser utilizados para las siguientes funciones sin ser enviados al cliente:
CENTROID: para identificar el centro en el que el cliente desea ser atendido.
SPECIALITY: para indicar si es un servicio de "Señora", "Caballero" o "Estética".
SERV: para indicar los servicios que desean los clientes.
LISTAPELUQ: para verificar la disponibilidad de un peluquero.
CONSULTHOR: para buscar si los peluqueros trabajan un dia especifico.
GUARDACITA: para guardar la cita en la base de datos
MODCITA: para modificar una cita.
CANCELACITA: para cancelar una cita.
CENTROINFO: para obtener la información de un centro.
Escribe todos los comandos que se hayan mencionado en el mensaje, uno en cada linea.
A la hora de escribir comandos, no uses [].

VERIFICA LA DISPONIBILIDAD DEL PELUQUERO CON EL SISTEMA SIN COMENTARSELO AL CLIENTE.
Verifica con el sistema primero y no digas al cliente que lo vas a consultar, usa el comando de LISTAPELUQ.

Todas las citas tienen que tener los siguientes datos para ser procesada: servicio, fecha y hora, salón, peluquero, y nombre del cliente.
Tienes que averiguar el servicio que desea hacerse el cliente, en cuanto el cliente te lo diga debes escribir solo "SERV" y debes incluir el servicio que te ha dicho el cliente, por ejemplo "SERV corte de pelo", "SERV manicura", etc...
Tienes que averiguar que centro quiere el cliente, se lo tienes que preguntar, cuando te lo diga escribe "CENTROID" y el centro que quiere el cliente y el sistema te dirá el id correspondiente del centro. Sólo manda el comando "CENTROID" si puedes poner el nombre del centro que te ha dicho el cliente.
El sistema tambien te dirá si debes preguntarle al cliente el tipo del servicio ("Señora", "Caballero" o "Estética"). Sólo puedes preguntarselo al cliente si el sistema te lo dice. Sólo si se lo has preguntado el cliente, en cuanto identifiques el tipo del servicio que desea hacerse el cliente tienes que escribir solo "SPECIALITY" y el tipo de servicio, que será "Señora", "Caballero" o "Estética".
Si has identificado que el cliente desea saber si un peluquero trabaja un dia especifico, pregunta de que salon. Una vez tengas ese dato, escribe "CONSULTHOR", la fecha en formato ISO_8601 con zona horaria UTC, el nombre del peluquero (si no se especifica el peluquero, escribe MOREINFO). SOlo puede ser una fecha, no un rango.
Si el cliente pide saber qué peluqueros hay disponibles, las horas disponibles de un peluquero en concreto, que le asignes uno aleatorio, o que le asignes un peluquero en concreto, asegúrate que hayan solicitado la hora deseada(sino, preestablecela a las 9h). Para saber la disponibilidad de peluqueros escribe SOLO "LISTAPELUQ" sin [], la fecha y hora en formato ISO con zona horaria de Madrid(Europa) y el nombre del peluquero que hayan solicitado (sino han solicitado ninguno escribe "MOREINFO") NADA MAS. LISTAPELUQ solo puede meter una fecha, no un rango de fechas. El sistema dirá la disponibilidad de los peluqueros.
Si el sistema ha confirmado disponibilidad, pregunta al cliente si desea confirmar la cita y escribe "GUARDACITA" y todos los detalles de la cita en el formato siguiente (pon solo los valores, sin las etiquetas de los datos incluyendo "|"): | Servicio | Fecha y hora (en formato ISO con zona horaria de Madrid(Europa) | Salón | Peluquero | Nombre del cliente
Si el cliente pide información sobre un centro (como el numero de telefono o la direccion), escribe "CENTROINFO" y el nombre del centro.

Si has identificado que el cliente desea cancelar su cita, pregunta por la fecha de su cita. Una vez tengas ese dato, escribe "CANCELACITA” y la fecha en "MM/DD/YYYY" y tener en cuenta el mensaje que te llegue del sistema para informar al cliente. 
Si has identificado que el cliente desea modificar su cita, pregunta por la fecha de su cita. Una vez tengas ese dato, escribe "MODCITA" y el dia de la cita en formato "DD/MM/YYYY". Despues pregunta al cliente que desea cambiar de su cita. Cuando tengas todos los datos nuevos, verifica con el sistema la disponibilidad sin comunicárselo al cliente con el comando LISTAPELUQ, verifica con el cliente si quiere confirmar si desea hacer el cambio y procede a guardar la nueva cita con el comando GUARDACITA.

Después de que el sistema haya confirmado que se han guardado los datos de la cita escribe que la cita ha sido confirmada y todos los detalles de la cita en el formato siguiente: *Servicio:*\n *Fecha y hora: (escribe la fecha en lenguaje natural)*\n *Salón:*\n *Peluquero:*\n *Nombre del cliente:*. (si ya le has enviado los detalles de la cita no se los vuelvas a enviar). 
Si el sistema dice que la cita ha sido cancelada con éxito a nombre de ese cliente le dices que se ha cancelado correctamente. Si el sistema te dice que no se pudo cancelar la cita, le dices que ha habido un error que no puedes gestionar y que, por favor, se ponga en contacto con el salón.

Cada mensaje que escribas con cosas como “te confirmaré en breve”, “voy a verificar…” o similar, es obligatorio pedirle confirmación al cliente, por ejemplo, acábalo con un “¿Te parece bien?” O “¿Estás de acuerdo?”:
Voy a verificar la disponibilidad de los peluqueros para el día 5 a las 17:00 en Nervión Caballeros. Te confirmo en breve. ¿Te parece bien?
Los comandos tienes que escribirlo perectos, si varías una letra, espacio o caracter no funcionará el sistema.
`;

// Función para pausar la ejecución por un tiempo determinado
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Configurar el transporte SMTP con Dinahosting
const transporter = nodemailer.createTransport({
  host: "ynok-eu.correoseguro.dinaserver.com", // Servidor SMTP de Dinahosting
  port: 465, // Puerto seguro SSL (también puedes usar 587 para TLS)
  secure: true, // Usar SSL (cambia a false si usas TLS en el puerto 587)
  auth: {
    user: process.env.EMAIL_USER, // Tu dirección de correo
    pass: process.env.EMAIL_PASS, // La contraseña de tu correo
  },
});

// Función para enviar correos
async function sendEmail(subject, text) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER, // Dirección desde la cual se envía el correo
      to: process.env.RECIPIENT_EMAIL, // Dirección del destinatario
      subject: subject,
      html: text,
    };
    //console.log(mailOptions);

    await transporter.sendMail(mailOptions);
    //console.log("Email enviado:", subject);
  } catch (error) {
    console.error("Error al enviar el email:", error);
  }
}

// Configuración del servidor Express
const app = express();
app.use(body_parser.json());

app.listen(PORT, async () => {
  await connectDB();
  await readDB();

  DoLog(`Webhook is listening on port: ${PORT}`);

  cron.schedule("* * * * *", async () => {
    try {
      const now = moment().tz("Europe/Madrid");

      if (now.format("HH:mm") === "21:00") {
        const stats =
          (await statisticsManager.getTodayStatistics()) ||
          (await statisticsManager.resetDailyCounters());
        
          // Contar citas creadas manualmente hoy
          const manualAppointmentsCountToday = await Appointments.countDocuments({
            createdBy: "Manual",
            createdAt: {
              $gte: moment().startOf("day").toDate(),
              $lte: moment().endOf("day").toDate(),
            },
          });

        // Crear el texto del email con todas las estadísticas diarias
        const emailText = `
        <p>Aquí tienes el resumen de estadísticas diarias:</p>
        <ul>
          <li>
            <strong>Citas confirmadas:</strong> ${
              stats.confirmedAppointments
            }<br>
            <a href="https://catnip-dashing-vase.glitch.me/appointments">[Ver citas confirmadas]</a>
          </li>
          <li>
            <strong>Citas canceladas:</strong> ${
              stats.canceledAppointments
            }</li>
          <li>
            <strong>Citas modificadas:</strong> ${stats.modifiedAppointments}
          </li>
          <li>
            <strong>Operaciones fallidas:</strong> ${
              stats.failedOperations
            }</li>
          <li>
            <strong>Interacciones:</strong> ${stats.interactions}<br>
            <a href="https://catnip-dashing-vase.glitch.me/chathistories">[Ver interacciones]</a>
          </li>
          <li>
            <strong>Citas creadas manualmente:</strong> ${manualAppointmentsCountToday}
          </li>
        </ul>
      `;
        /*
          <li>
            <strong>Encuestas completadas:</strong> ${
              stats.feedbackResponses
            }<br>
            <a href="https://catnip-dashing-vase.glitch.me/surveyResponses">[Ver encuestas]</a>
          </li>
          <li>
            <strong>Escaneos del QR:</strong> ${stats.qrScans || 0}
          </li>
        */

        // Enviar el correo con las estadísticas diarias
        await sendEmail(
          "Estadísticas Diarias: Ébanni Peluqueros DEV",
          emailText
        );
        DoLog(`Email de estadísticas diarias enviado correctamente.`);

        // Guardar estadísticas del día en un nuevo documento
        await statisticsManager.saveDailyStats(stats);
      }
    } catch (error) {
      DoLog(`Error ejecutando el cron diario: ${error}`, Log.Error);
      console.error("Error ejecutando el cron diario:", error);
    }
  });

  // Cron para ejecutar el primer día de cada mes a las 00:00
  cron.schedule("* * * * *", async () => {
    try {
      const now = moment().tz("Europe/Madrid");

      // Verificar si es el primer día del mes a las 00:00
      if (now.date() === 1 && now.format("HH:mm") === "00:00") {
        //console.log("Ejecutando cron job mensual...");

        // Obtener estadísticas del mes anterior
        const monthlyStats = await statisticsManager.getMonthlyStatistics();

        // Crear el texto del reporte
        const emailText = `
        <h2>Estadísticas del mes anterior:</h2>
        <ul>
          <li><strong>Citas confirmadas:</strong> ${monthlyStats.confirmedAppointments}</li>
          <li><strong>Citas modificadas:</strong> ${monthlyStats.modifiedAppointments}</li>
          <li><strong>Citas canceladas:</strong> ${monthlyStats.canceledAppointments}</li>
          <li><strong>Operaciones fallidas:</strong> ${monthlyStats.failedOperations}</li>
          <li><strong>Interacciones:</strong> ${monthlyStats.interactions}</li>
          <li><strong>Encuestas completadas:</strong> ${monthlyStats.feedbackResponses}</li>
        </ul>
      `;

        // Enviar el correo con las estadísticas mensuales
        await sendEmail(
          "Estadísticas Mensuales: Ébanni Peluqueros DEV",
          emailText
        );
        //console.log("Reporte mensual enviado con éxito.");
      }
    } catch (error) {
      DoLog(`Error ejecutando el cron mensual: ${error}`, Log.Error);
      console.error("Error ejecutando el cron mensual:", error);
    }
  });

  // CONFIGURAR EL CRON DE RECORDATORIOS:
  // 1.- Poner la hora a la que se quiere que se ejcute, por ejemplo a las 19:30: "30 19 * * *". Dejar "* * * * *" para que se ejecute cada minuto y hacer pruebas.
  cron.schedule("* * * * *", async () => {
    const now = moment().tz("Europe/Madrid");
    if (now.format("HH:mm") === "10:04") {
      let tomorrow = moment().add(1, "days").format("MM/DD/YYYY");

      // 2.- Comentar esta línea para que busque en el dia de mañana. La fecha que está puesta es domingo y hay sólo una cita de prueba.
      // El botón de "Cancelar Cita" sólo busca las citas de mañana, por lo que si dejas esta línea no funcionará bien.
      //tomorrow = "10/04/2024";

      // 3.- En el filtro se puede poner clientPhone: "xxxxxxx" para hacer pruebas y enviar solo el mensaje de un cliente
      let appointments = await Appointments.find({
        date: tomorrow,
        services: { $exists: true, $ne: [] },
      });

      for (let appointment of appointments) {
        let from = appointment.clientPhone;
        let clientName = appointment.clientName;
        let dia = "mañana";
        let initTime = moment(appointment.initTime, "HH:mm").format("HH:mm");

        // 4.- Comentar esta línea para que mande el mensaje al cliente. Se puede poner aqui el telefeno que queramos para que se le envien todos los mensajes y ver que se están creando bien.
        //from = "34722225152";

        // 5.- Descomentar esta línea para que mande los mensajes
        WhatsApp.SendTemplateRecordatorio(
          _phone_number_id,
          from,
          clientName,
          dia,
          initTime
        );
        sleep(7000);
      }
    }
  });
});

// FUTURA ACTUALIZACION
// CREAR UN LINK DESDE NUESTRO SERVIDOR QUE REDIRIJA AL WHATSAPP
// CONTABILIZA EL NUMERO DE VECES QUE EL LINK SE HA ABIERTO
app.get("/qrwhatsapp", async (req, res) => {
  console.log("servidor de QR WhatsApp!");
  try {
    // Incrementar el contador de escaneos en MongoDB
    await statisticsManager.incrementQRScans();

    // Redirigir al número de WhatsApp
    const whatsappURL = "https://wa.me/34915647612";
    res.redirect(whatsappURL);
  } catch (error) {
    console.error("Error al incrementar el contador de QR:", error);
    res.status(500).send("Error al redirigir");
  }
});

// Ruta para obtener citas creadas hoy
app.get("/appointments", async (req, res) => {
  try {
    const today = moment().format("YYYY-MM-DD"); // Fecha de hoy en formato 'YYYY-MM-DD'

    // Buscar citas donde la fecha de creación coincide con hoy
    const todayAppointments = await Appointments.find({
      $expr: {
        $eq: [
          { $substr: ["$createdAt", 0, 10] }, // Extraer 'YYYY-MM-DD' de createdAt
          today,
        ],
      },
    });

    res.send(`
      <html>
        <body>
          <h2>Citas de hoy</h2>
          <pre>${JSON.stringify(todayAppointments, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error al obtener las citas creadas hoy:", error);
    res.status(500).send("Error al obtener las citas creadas hoy");
  }
});

// Ruta para ver respuestas de encuestas de hoy
app.get("/surveyResponses", async (req, res) => {
  try {
    const today = moment().startOf("day").toDate();
    const responses = await SurveyResponse.find({
      date: { $gte: today },
    });
    res.send(`
      <html>
        <body>
          <h2>Encuestas de hoy</h2>
          <pre>${JSON.stringify(responses, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error al obtener respuestas de encuestas:", error);
    res.status(500).send("Error al obtener respuestas de encuestas");
  }
});

// Ruta para obtener las conversaciones del día de hoy
app.get("/chathistories", async (req, res) => {
  try {
    const today = moment().format("YYYY-MM-DD"); // Fecha de hoy en formato 'YYYY-MM-DD'

    // Filtrar las conversaciones que coincidan con la fecha de hoy
    const conversationsToday = await ChatHistory.find({
      $expr: {
        $eq: [
          { $substr: ["$startedAt", 0, 10] }, // Extraer 'YYYY-MM-DD' de startedAt
          today,
        ],
      },
    });

    // Devolver los documentos con el campo `conversation` modificado
    res.send(`
      <html>
        <body>
          <h2>Interacciones de hoy</h2>
          <pre>${JSON.stringify(conversationsToday, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error al obtener las conversaciones de hoy:", error);
    res.status(500).send("Error al obtener las conversaciones de hoy");
  }
});

app.get("/full-history/:from", async (req, res) => {
  try {
    // Obtener el parámetro `from` de la URL
    const from = req.params.from;

    // Realizar consultas paralelas a las colecciones
    const [chatHistories, surveyResponses, appointments] = await Promise.all([
      ChatHistory.find({ from }), // Buscar en `chathistories`
      SurveyResponse.find({ phoneNumber: from }), // Buscar en `surveyResponses`
      Appointments.find({ clientPhone: from }), // Buscar en `appointments`
    ]);

    // Formatear las conversaciones en `chatHistories`
    const formattedChatHistories = chatHistories.map((conversation) => {
      conversation.conversation = conversation.conversation
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
      return conversation.toObject(); // Convertir a objeto JavaScript
    });

    // Formatear las citas en `appointments`
    const formattedAppointments = appointments.map((appointment) => {
      return {
        date: appointment.date,
        initTime: appointment.initTime,
        finalTime: appointment.finalTime,
        clientName: appointment.clientName,
        services: appointment.services.map((service) => service.serviceName),
        centerInfo: appointment.centerInfo,
      };
    });

    // Respuesta con el historial completo
    const fullHistory = {
      chatHistories: formattedChatHistories,
      surveyResponses: surveyResponses.map((response) => response.toObject()),
      appointments: formattedAppointments,
    };

    res.send(`
      <html>
        <body>
          <h2>Historial Completo de ${from}</h2>
          <pre>${JSON.stringify(fullHistory, null, 2)}</pre>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Error al obtener el historial completo del cliente:", error);
    res.status(500).send("Error al obtener el historial completo del cliente");
  }
});

app.get("/test", (req, res) => {
  DoLog("TEST");
  res.send("TEST");
});

app.get("/", (req, res) => {
  res.sendStatus(403);
});

// Verificación del webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token) {
    if (mode == "subscribe" && token == WEBHOOK_VERIFY_TOKEN) {
      res.status(200).send(challenge);
      DoLog("Webhook verified successfully!");
      return;
    }
  }
  res.sendStatus(403);
});

// Recepción de mensajes desde el webhook
app.post("/webhook", async (req, res) => {
  let curr = Conversation.GetConversation(req);
  if (curr != null) {
    if (curr.from ?? "" != "") {
      if (curr.lastMsg.audio) {
        // let msg = "En estos momentos no puedo escuchar audios, por favor, escribe tu mensaje.";
        // curr.Responder(msg);
        const transcripcion = await transcribirAudio(curr.lastMsg.audio.id);
        if (transcripcion) {
          curr.lastMsg.type = "text";
          curr.lastMsg.audio = false; // Para que se trate como texto
          curr.lastMsg.who = WhoEnum.User;
          curr.lastMsg.newID = true;
          curr.lastMsg.message = transcripcion;
          curr.AddMsg(curr.lastMsg);
        } else {
          curr.Responder(
            "Lo siento, no consigo escuchar el audio, ¿puedes escribírmelo?"
          );
        }
      }
      if (curr.lastMsg.type === "interactive") {
        const message = req.body.entry[0].changes[0].value.messages[0];

        if (message.interactive && message.interactive.nfm_reply) {
          const responseData = JSON.parse(
            message.interactive.nfm_reply.response_json
          );
          const dateNow = moment().tz("Europe/Madrid").format();
          //console.log(responseData);

          // Save the data to MongoDB
          const surveyResponse = new SurveyResponse({
            phoneNumber: curr.from,
            citaRadio: responseData.recommend_radio,
            botExistance: responseData.comment_text,
            opinionFeedback: responseData.service_feedback,
            improvementFeedback: responseData.improvement_feedback,
            date: dateNow,
          });

          //console.log(surveyResponse);
          try {
            await surveyResponse.save();
            // Increment feedback count in stats
            statisticsManager.incrementFeedbackResponses();
            //console.log("Survey response saved successfully.");
          } catch (error) {
            console.error("Error saving survey response:", error);
          }
        }
      } else {
        curr.lastMsg.who = WhoEnum.User;
        curr.lastMsg.newID = true;
        curr.AddMsg(curr.lastMsg);
        //console.log("curr.lastMsg:", curr.lastMsg);
      }
    }
  }
  res.sendStatus(200);
});

async function transcribirAudio(mediaId) {
  try {
    // Obtener la URL del archivo de audio desde la API de WhatsApp

    // Hacer la solicitud GET para obtener la URL del archivo multimedia
    const mediaResponse = await axios.get(
      `https://graph.facebook.com/v15.0/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${GRAPH_API_TOKEN}`,
        },
      }
    );

    const audioUrl = mediaResponse.data.url;
    //console.log("URL del audio:", audioUrl);

    // Enviar la URL del audio a tu servidor Whisper en Replit
    const response = await axios.post(
      "https://whispery-nok-dani107.replit.app/transcribe",
      {
        // <-- Cambia aquí la URL
        audioData: {
          id: mediaId,
          url: audioUrl,
        },
      }
    );

    const transcripcion = response.data.transcription;
    //console.log("Transcripción obtenida:", transcripcion);

    return transcripcion;
  } catch (error) {
    // Llamada a LogError con la fecha en la zona horaria de Madrid
    await LogError(this.from, `Error al transcribir audio`, error.message);
    DoLog(`Error al transcribir audio:${error}`, Log.Error);
    return null;
  }
}

// Función para registrar logs
function DoLog(txt, type = Log.Log) {
  let fecha = new Date().toISOString().replace(/T/, " ").replace(/\..+/, "");
  let msg = `${fecha} - ${txt}`;
  switch (type) {
    case Log.Log:
      console.log(msg);
      break;
    case Log.Error:
      console.error(msg);
      break;
  }
}

async function LogError(phoneNumber, message, error, centerID, centerName) {
  const errorDate = moment().tz("Europe/Madrid").format(); // Fecha actual con zona horaria de Madrid

  const errorData = new MetaData({
    phoneNumber: phoneNumber,
    centerID: centerID,
    centerName: centerName,
    type: "error",
    message: message || error.message, // Mensaje de error
    partOfProgram: error.stack, // Traza completa del error
    date: errorDate, // Fecha y hora con zona horaria de Madrid
  });

  //console.log("Datos del error preparados para el log:", errorData);

  try {
    await errorData.save(); // Try to save the log data
    DoLog(`Error de la aplicación enviado guardado en MONGO correctamente.`);
    //console.log("Error log saved successfully.");
  } catch (saveError) {
    DoLog(`Error al guardar error a MONGO:${saveError}`, Log.Error);
    console.error("Error while saving to MongoDB:", saveError.message); // Catch errors during save
  }

  // Sending email with the error details
  const emailText = `
    <p>DEV - Error ocurrido en la aplicación:</p>
  <ul>
    <li><strong>Número de cliente:</strong> ${phoneNumber}</li>
    <li><strong>CentroID:</strong> ${centerID}</li>
    <li><strong>Centro seleccionado:</strong> ${
      centerName || "Centro no especificado"
    }</li>
    <li><strong>Fecha y hora (Madrid):</strong> ${errorDate}</li>
    <li><strong>Mensaje de error:</strong> ${message || error.message}</li>
    <li><strong>Traza completa del error:</strong><br><pre>${
      error.stack
    }</pre></li>
  </ul>
  `;

  try {
    await sendEmail("DEV Error en la aplicación", emailText);
    DoLog(`Error de la aplicación enviado a admin@ynok.eu correctamente.`);
    //console.log("Correo de error enviado correctamente");
  } catch (emailError) {
    DoLog(`Error al enviar email: ${emailError}`, Log.Error);
    console.error(
      "Error al intentar enviar el correo de error:",
      emailError.message
    );
  }
}

async function LogSuccess(phoneNumber, message, centerID, centerName) {
  const successDate = moment().tz("Europe/Madrid").format(); // Fecha actual con zona horaria de Madrid

  const successData = new MetaData({
    phoneNumber,
    type: "success", // Tipo de registro
    message: message, // Mensaje asociado con el éxito
    centerID: centerID || "ID no especificado", // ID del centro, o texto por defecto
    centerName: centerName || "Nombre del centro no especificado", // Nombre del centro
    date: successDate, // Fecha y hora con zona horaria de Madrid
  });

  try {
    await successData.save(); // Guardar el registro en la base de datos
    //console.log(`Éxito registrado: ${message} - Centro: ${centerName || centerID}`);
  } catch (error) {
    console.error("Error al registrar el éxito:", error);
  }
}

class Conversation {
  static GetConversation(req) {
    let rtn = null;
    let from =
      req?.body?.entry?.[0]?.changes[0]?.value?.messages?.[0]?.from ?? null;
    if (from) {
      //comprueba si ya existe conversacion del from
      if (Object.keys(conversaciones).indexOf(from) < 0) {
        rtn = new Conversation();
        rtn.InitFromReq(req);
        conversaciones[from] = rtn;
        rtn.startedAt = new Date();
        //console.log("rtn.startedAt:", rtn.startedAt);
        DoLog(`Conversacion con ${from} iniciada`);

        // Incrementar interacciones (nueva conversación)
        statisticsManager.incrementInteractions();
      } else {
        //si existe la obtiene del array
        rtn = conversaciones[from];
      }
      rtn.lastMsg = new Message();
      rtn.lastMsg.InitFromReq(req);
    }
    return rtn;
  }

  constructor() {
    this.from = "";
    this.lastMsg = new Message();
    this.messages = [];
    this.borrarTimeOut = null;
    this.startedAt = null;
    this.endedAt = null;
    this.responderTimeOut = null;
    this.watchdogTimeOut = null;
    this.especialidad = "";
    this.especialidadID = "";
    this.watchdogCount = 3;
    this.full = "";
    this.salonID = "";
    this.salonNombre = "";
    this.duracionServicio = 30;
    this.nombreServicio = "";
    this.fecha = "";
    this.hora = "";
    this.peluquero = "";
    this.peluqueroNombre = "";
    this.isRandom = false;
    this.nombre = "";
    this.citaGuardada = false;

    // Variables nuevas para modificación de cita
    this.citaAntigua = null; // Almacena la cita existente antes de la modificación
    this.modificacionActiva = false; // Indica si estamos en el proceso de modificación
    
    this.commandQueue = new CommandQueue();
  }

  // inicia conversacion desde la request
  InitFromReq(req) {
    let value = req?.body?.entry?.[0]?.changes[0]?.value ?? null;
    let msg_obj = value?.messages?.[0] ?? null;
    _phone_number_id = value?.metadata?.phone_number_id ?? _phone_number_id;
    this.from = msg_obj?.from ?? "";
  }

  Init(phone_number_id, from) {
    _phone_number_id = phone_number_id ?? _phone_number_id;
    this.from = from ?? "";
  }

  // responder whatsapp
  async Responder(body) {
    await WhatsApp.Responder(_phone_number_id, this.from, body);
    let ids = this.GetNewID();
    await WhatsApp.MarkRead(_phone_number_id, ids);
  }

  ExistsID(id) {
    let rtn = false;
    for (let i = 0; i < this.messages.length; ++i) {
      if (this.messages[i].msg_id == id) {
        rtn = true;
        break;
      }
    }
    return rtn;
  }

  // añade mensaje al bloque de mensajes
  AddMsg(msg) {
    this.CancelBorrar(true);
    if (msg.who == WhoEnum.User) {
      if (!this.ExistsID(msg.msg_id)) {
        this.CancelResponder(true);
        this.messages.push(msg);
      }
    } else {
      this.messages.push(msg);
    }
    // Guardar la conversación directamente después de cada mensaje
    // MongoDB.GuardarConversacion(this.from, this.messages);
  }

  async Borrar() {
    this.CancelResponder();
    this.CancelWatchDog();
    this.CancelBorrar();
    this.endedAt = new Date(new Date().getTime() - 15 * 60 * 1000);
    // Concatenar la conversación en un solo string
    let conversationText = this.messages
      .map((msg) => {
        switch (msg.who) {
          case WhoEnum.User:
            return `Cliente: ${msg.message}`;
          case WhoEnum.ChatGPT:
            return `ChatGPT: ${msg.message}`;
          case WhoEnum.System:
            return `Sistema: ${msg.message}`;
          default:
            return msg.message;
        }
      })
      .join("\n");

    //console.log("this.startedAt", this.startedAt);
    console.log("this.endedAt", this.endedAt);
    // Crear un nuevo documento para guardar en MongoDB
    const chatHistory = new ChatHistory({
      from: this.from,
      conversation: conversationText, // Guardar la conversación como un solo string
      startedAt: this.startedAt, // Fecha de inicio de la conversación
      endedAt: this.endedAt, // Fecha de fin de la conversación
    });

    //console.log(chatHistory);

    try {
      // Guardar en MongoDB usando await
      await chatHistory.save();
      DoLog(`Conversación con ${this.from} guardada en MongoDB correctamente`);
    } catch (err) {
      DoLog(`Error al guardar la conversación en MongoDB: ${err}`, Log.Error);
    }

    // Enviar encuesta y eliminar la conversación
    //WhatsApp.SendTemplateEncuesta(_phone_number_id, this.from);
    delete conversaciones[this.from];
    DoLog(
      `Conversacion con ${this.from} finalizada tras ${this.messages.length} mensajes`
    );
  }

  // cancelar el temporizador de vigilancia actual. Este contador se utiliza para realizar un seguimiento del número de intentos de manejar la situación problemática.
  // el sistema intentará manejar la situación un número limitado de veces (3 veces, según la implementación actual)
  CancelWatchDog(reRun = false) {
    if (this.watchdogTimeOut) {
      clearTimeout(this.watchdogTimeOut);
      this.watchdogTimeOut = null;
    }
    if (reRun) {
      this.watchdogTimeOut = setTimeout(
        () => this.DoWatchDog(),
        TIMEOUT_WATCHDOG
      );
    } else {
      this.watchdogCount = 3;
    }
  }

  CancelBorrar(reRun = false) {
    // Si existe un temporizador de borrado, se cancela
    if (this.borrarTimeOut) {
      clearTimeout(this.borrarTimeOut);
      this.borrarTimeOut = null;
    }
    // Si se especifica reRun como verdadero, se establece un nuevo temporizador
    if (reRun) {
      // Se configura un nuevo temporizador para llamar a la función Borrar después de un período de tiempo definido
      this.borrarTimeOut = setTimeout(() => this.Borrar(), TIMEOUT_BORRAR);
    }
  }

  CancelResponder(reRun = false) {
    if (this.responderTimeOut) {
      clearTimeout(this.responderTimeOut);
      this.responderTimeOut = null;
    }
    if (reRun) {
      this.responderTimeOut = setTimeout(
        () => this.Process(),
        TIMEOUT_RESPONDER
      );
    }
  }

  // si entra es porque va a reintentar un error y reduce el temporizador una vez
  async DoWatchDog() {
    this.CancelWatchDog(true);
    --this.watchdogCount;
    if (this.watchdogCount > 0) {
      try {
        let rtn = new Message(WhoEnum.System);
        rtn.message = `Ha ocurrido un problema al procesar el último mensaje del cliente. Debes comunicarle que ha habido un error y poedirle que lo intente de nuevo.`;
        DoLog(rtn.message);

        // Llamada a LogError con la fecha en la zona horaria de Madrid
        await LogError(this.from, rtn.message, this.salonID, this.salonNombre);

        this.AddMsg(rtn);
        // obtiene la conversacion entera y se la pasa a chatgpt para que reanude
        this.GetFull();
        let msg = `${this.full}.\n Teniendo toda esta conversación, ¿qué le dirías al cliente? SOLO escribe el mensaje que debería llegarle al cliente. Si necesitas realizar una acción (como guardar la cita) escribe el comando correspondiente y se le enviará al sistema en vez de al cliente. El sistema te enviará la información correspondiente al comando o te confirmará una acción que hayas solicitado mediante comando`;
        rtn = new Message(WhoEnum.ChatGPT);
        rtn.message = await ChatGPT.SendToGPT(msg);
        this.AddMsg(rtn);
        if (rtn.message != "") {
          await WhatsApp.Responder(_phone_number_id, this.from, rtn.message);
          this.CancelWatchDog();
          return;
        }
      } catch (ex) {
        // Captura y registra el error con su mensaje original
        await LogError(
          this.from,
          `Error en DoWatchDog`,
          ex,
          this.salonID,
          this.salonNombre
        );
        // Incrementar el contador de operaciones fallidas
        await statisticsManager.incrementFailedOperations();
        DoLog(`Error en DogWatch: ${ex}`, Log.Error);
      }
    }
    await WhatsApp.Responder(
      _phone_number_id,
      this.from,
      "Lo siento, ha ocurrido un error con el último mensaje, por favor vuelve a enviarmelo."
    );
  }

  async Process() {
    this.CancelResponder();
    this.CancelWatchDog(true);
    // Verificar si el último mensaje proviene del usuario
    if (this.lastMsg?.who == WhoEnum.User) {
      try {
        if (
          this.lastMsg.type == "button" &&
          this.lastMsg.message == "Cancelar cita"
        ) {
          this.lastMsg = null;

          let rtn = new Message(WhoEnum.System);

          let tomorrow = moment().add(1, "days").format("MM/DD/YYYY");
          let appointments = await Appointments.find({
            date: tomorrow,
            clientPhone: this.from,
          });

          if (appointments.length == 0) {
            rtn.message = "No tienes ninguna cita para mañana.";
          } else {
            for (let appointment of appointments) {
              await Appointments.deleteOne({ _id: appointment._id });
            }
            rtn.message =
              "*Cita cancelada correctamente.* Gracias por cancerlarla. Puedes volver a escribirnos por aquí si quieres volver a pedir una cita o para cualquier cosa que necesites. Que tengas buen día.";
          }

          this.AddMsg(rtn);

          await WhatsApp.Responder(_phone_number_id, this.from, rtn.message);
          this.CancelResponder();
          this.CancelWatchDog();
        } else {
          this.lastMsg = null;
          this.GetFull();
          console.log("this.full:", this.full);
          let gptResponse = await ChatGPT.SendToGPT(this.full);
          let rtn = "";
          let gpt = new Message(WhoEnum.ChatGPT);
          gpt.message = gptResponse;
          this.AddMsg(gpt);

          let lines = gptResponse.split('\n').filter(line => line.trim() !== '');
          console.log("lines:", lines);
          
          // Añadir cada línea como un comando separado a la cola
          let hasCommands = false;
          for (let line of lines) {
            if (line.includes('SERV') || line.includes('SPECIALITY') || 
                line.includes('CENTROID') || line.includes('LISTAPELUQ') || 
                line.includes('GUARDACITA') || line.includes('CANCELACITA') || 
                line.includes('CONSULTHOR') || line.includes('BUSCARCITA') || 
                line.includes('MODCITA') || line.includes('SALON') || 
                line.includes('CENTROINFO')) {
              this.commandQueue.addCommand(line);
              hasCommands = true;
            }
          }
          
          if (hasCommands) {
            // Si hay comandos, procesarlos
            rtn = await this.commandQueue.processNextCommand(this);
            console.log("rtn:", rtn);
          } else {
            // Si no hay comandos, usar la respuesta directa de GPT
            rtn = gptResponse;
            console.log("rtn 2:", rtn);
          }
          
          // Si hay una respuesta final, enviarla
          if (rtn != "") {
            await WhatsApp.Responder(_phone_number_id, this.from, rtn);
            this.CancelWatchDog();
          }
          return rtn;
        
        }
      } catch (ex) {
        DoLog(`Error en Process ${ex}`, Log.Error);
      }
    }
  }

  async ProcessOne(gpt) {
    gpt.SetGPT();
    if (gpt.GPT != GPTEnum.NONE) {
      DoLog(gpt.message);
    }
    let rtn = "";
    switch (gpt.GPT) {
      case GPTEnum.SERV:
        rtn = await this.ProcesarSolicitudDeServicio(gpt.message);
        break;
      case GPTEnum.SPECIALITY:
        rtn = await this.ProcesarSpeciality(gpt.message);
        break;
      case GPTEnum.CENTROID:
        rtn = await this.ProcesarCentro(gpt.message);
        break;
      case GPTEnum.LISTAPELUQ:
        rtn = await this.ProcesarPeluquero(gpt.message);
        break;
      case GPTEnum.CONSULTHOR:
        //console.log("CONSULTHOR ejecutado");
        rtn = await this.ProcesarConsultarHorario(gpt.message);
        break;
      case GPTEnum.GUARDACITA:
        rtn = await this.ProcesarCita(gpt.message);
        break;
      case GPTEnum.CANCELACITA:
        rtn = await this.ProcesarCancelacionCita(gpt.message);
        break;
      //case GPTEnum.HORACOMIDA:
      //rtn = await this.ProcesarSolicitudDeHoraDeComida(gpt.message);
      //break;
      //case GPTEnum.BAJAPELUQ:
      //rtn = await this.ProcesarBajaPeluquero(gpt.message);
      //break;
      //case GPTEnum.CAMBIOHORARIO:
      // rtn = await this.ProcesarModificacionCita(gpt.message)
      //break;
      case GPTEnum.SALON:
        rtn = await this.ProcesarSalon(gpt.message);
        break;
      case GPTEnum.MODCITA:
        //rtn = `Para modificar tu cita, por favor cancela tu cita antigua y pide una nueva. Gracias.`
        rtn = await this.ProcesarModificacionCita(gpt.message);
        break;
      case GPTEnum.CENTROINFO:
        rtn = await this.ProcesarInfoCentro(gpt.message);
        break;
      case GPTEnum.NONE:
        rtn = gpt.message;
        break;
    }
    return rtn;
  }

  GetFull() {
    this.full = "";
    for (let i = 0; i < this.messages.length; ++i) {
      switch (this.messages[i].who) {
        case WhoEnum.User:
          this.full += `El cliente ${this.from} ha dicho: [${this.messages[i].message}].\n`;
          break;
        case WhoEnum.ChatGPT:
          this.full += `Y tú le has respondido: [${this.messages[i].message}].\n`;
          break;
        case WhoEnum.System:
          this.full += `El sistema ha dicho: [${this.messages[i].message}].\n`;
          break;
      }
    }
    return this.full;
  }

  GetNewID() {
    let rtn = [];
    for (let i = 0; i < this.messages.length; ++i) {
      if (this.messages[i].newID) {
        if (this.messages[i].msg_id ?? "" != "") {
          rtn.push(this.messages[i].msg_id);
        }
        this.messages[i].newID = false;
      }
    }
    return rtn;
  }

  async ProcesarSolicitudDeServicio(gpt) {
    let msg = gpt.replace("SERV", "").replace("[", "").replace("]", "").trim();

    //console.log(`Mensaje recibido para procesamiento de servicios: "${msg}"`);

    // Identificar servicios individuales (separados por ",", "y", etc.)
    let serviciosIdentificados = msg.split(/,| y /).map((s) => s.trim());
    //console.log(`Servicios identificados: ${JSON.stringify(serviciosIdentificados)}`);

    let serviciosIDs = [];
    let duracionTotal = 0;

    // Obtener los IDs de los servicios a través de CalculaServicioID
    for (let servicio of serviciosIdentificados) {
      //console.log(`Procesando servicio: "${servicio}"`);

      // Obtener el ID del servicio usando la función CalculaServicioID
      let servicioID;
      try {
        servicioID = await ChatGPT.CalculaServicioID(servicio);
      } catch (error) {
        console.error(`Error al identificar el servicio ${servicio}: ${error}`);
        return `Ocurrió un error al procesar el servicio "${servicio}".`;
      }

      if (servicioID) {
        //console.log(`Servicio identificado: ${servicio} -> ID: ${servicioID}`);
        serviciosIDs.push(servicioID);

        // Buscar información del servicio (duración, etc.)
        //console.log("Servicios disponibles:", servicios);
        let servicioInfo = servicios.find(
          (s) => s.servicioID.toString() === servicioID
        ); // Cambio aquí

        if (servicioInfo) {
          //console.log(`Servicio encontrado en la lista: ${JSON.stringify(servicioInfo)}` );
          duracionTotal += parseInt(servicioInfo.duracion); // Sumamos la duración del servicio
        } else {
          console.error(
            `Error: No se encontró información del servicio con ID: ${servicioID}`
          );
          return `Error: No se pudo encontrar información para el servicio "${servicio}".`;
        }
      } else {
        //console.log(`No se encontró el servicio: ${servicio}`);
        return `No se pudo identificar el servicio "${servicio}".`;
      }
    }

    // Confirmación y almacenamiento de servicios
    let rtn = new Message(WhoEnum.System);
    if (serviciosIDs.length > 0) {
      let nombresServicios = servicios
        .filter((s) => serviciosIDs.includes(s.servicioID.toString()))
        .map((s) => s.servicio); // Cambio aquí
      //console.log(`Servicios confirmados: ${nombresServicios.join(", ")} con una duración total de ${duracionTotal} minutos`);

      rtn.message = `Comando SERV confirmado. Los servicios que desea agendar el cliente ${
        this.from
      } son "${nombresServicios.join(
        ", "
      )}", con una duración total de ${duracionTotal} minutos.`;
    } else {
      //console.log(`No se pudieron identificar correctamente los servicios solicitados.`);
      rtn.message = `No se pudieron identificar correctamente los servicios solicitados.`;
    }

    DoLog(rtn.message);
    this.AddMsg(rtn);

    // Almacenar la información de los servicios y la duración
    this.nombreServicio = serviciosIDs; // Guardamos los IDs de los servicios
    this.duracionServicio = duracionTotal;

    return "";
  }

  async ProcesarSpeciality(gpt) {
    let msg = gpt
      .replace("SPECIALITY", "")
      .replace("[", "")
      .replace("]", "")
      .trim();
    let rtn = new Message(WhoEnum.System);
    this.especialidadID = "";
    this.especialidad = "";
    for (let especialidad of especialidades) {
      if (especialidad.name.toUpperCase() == msg.toUpperCase()) {
        this.especialidadID = especialidad.especialidadID;
        this.especialidad = especialidad.name;
      }
    }
    if (this.especialidadID != "") {
      rtn.message = `Comando SPECIALITY confirmado. El servicio que desea agendar el cliente es de tipo "${this.especialidad}" con ID "${this.especialidadID}".`;
    } else {
      rtn.message = `No se pudo identificar la especialidad "${msg}" para el cliente${this.from}.`;
    }
    DoLog(rtn.message);
    this.AddMsg(rtn);
    return "";
  }

  async ProcesarCentro(gpt) {
    let msg = gpt
      .replace("CENTROID", "")
      .replace("[", "")
      .replace("]", "")
      .trim();
    let centro = "";
    let centroValido = false;
    for (let i = 1; i <= 3; ++i) {
      centro = await ChatGPT.CalculaCentroID(msg);
      if (centro != "") {
        this.salonID = centro;
        let salon = await MongoDB.ObtenerSalonPorSalonID(this.salonID);
        this.salonNombre = salon.nombre;
        centroValido = true;
        break;
      } else {
        this.salonID = "";
      }
      sleep(100);
    }
    let rtn = new Message(WhoEnum.System);
    if (!centroValido) {
      rtn.message = `No se pudo identificar el centro "${msg}" para el cliente ${this.from}.`;
    } else {
      rtn.message = `Comando CENTROID confirmado. El salon que desea agendar el cliente ${this.from} es "${this.salonNombre}", con id "${this.salonID}".`;
      if (MongoDB.EsMixto(this.salonID)) {
        rtn.message +=
          ' Clarifica con el cliente si será servicio de "Señora" o "Caballero".';
      }
    }
    DoLog(rtn.message);
    this.AddMsg(rtn);
    return "";
  }

  async ProcesarPeluquero(gpt) {
    let rtn = new Message(WhoEnum.System);
    //console.log("gpt:", gpt);
    // Dividir gpt en fecha y nombre usando el último espacio como separador
    let partes = gpt
      .replace("LISTAPELUQ", "")
      .trim()
      .split(/\s+(?=[^\s]+$)/);
    //console.log("partes:", partes);
    let fecha = partes[0];
    let nombre = partes[1] ? partes[1].trim() : ""; // Si hay nombre, lo tomamos; si no, es una cadena vacía

    //console.log("Fecha:", fecha);
    //console.log("this.nombreServicio:", this.nombreServicio);

    //console.log(fecha);
    if (moment(fecha, moment.ISO_8601, true).isValid()) {
      DoLog(`FECHA: ${fecha}`, Log.Error);

      // Calculamos el peluquero por el nombre
      let peluqueroID = await ChatGPT.CalculaPeluquero(nombre, this.salonID);
      //console.log("peluqueroID:", peluqueroID);

      for (let peluquero of peluqueros) {
        if (peluquero.peluqueroID == peluqueroID) {
          this.peluquero = peluquero;
          //console.log("this.peluquero:", this.peluquero);
          break;
        } else {
          this.peluquero = "";
        }
      }

      //this.peluquero = "";
      this.isRandom = false;
      fecha = moment(fecha);

      // ESTE IF ES POR EL CAMIO DE HORA DEL 27 DE OCTUBRE DE 2024
      if (fecha.isAfter("2024-10-27")) {
        fecha = fecha.utcOffset("+0200");
        //        fecha = fecha.add(-1, "hours");
      }
      DoLog(`FECHA: ${fecha}`, Log.Error);

      if (this.salonID == "") {
        rtn.message = "Lo siento, falta conocer el salón.";
      } else if (this.nombreServicio == "") {
        rtn.message = "Lo siento, falta conocer el servicio.";
      } else if (this.especialidadID == "" && MongoDB.EsMixto(this.salonID)) {
        rtn.message = "Lo siento, falta conocer el tipo de servicio.";
      } else {
        this.fecha = fecha.utc().format("YYYY-MM-DD");
        this.hora = fecha.tz("Europe/Madrid").format("HH:mm:ss");
        /*console.log(
          "SERGIO: Obtener la lista de peluqueros disponibles a la hora solicitada:",
          fecha,
          this.salonID,
          this.nombreServicio,
          this.especialidadID,
          this.duracionServicio
        );*/

        // Obtener la lista de peluqueros disponibles a la hora solicitada
        let peluquerosDisponibles = await MongoDB.ListarPeluquerosDisponibles(
          fecha,
          this.salonID,
          this.nombreServicio,
          this.especialidadID,
          this.duracionServicio
        );

        //console.log("LN 1210 peluquerosDisponibles:", peluquerosDisponibles);

        //console.log("this.peluqueroNombre:", this.peluqueroNombre);
        if (this.peluquero != "") {
          //console.log("entra en condicion del peluquero identificado");
          //console.log("this.peluquero:", this.peluquero);
          // Si el cliente pidió un peluquero específico
          if (peluquerosDisponibles.includes(this.peluquero.peluqueroID)) {
            // El peluquero está disponible

            rtn.message = `El peluquero ${this.peluqueroNombre} está disponible para el ${this.fecha} a las ${this.hora}. ¿Quieres confirmar la cita?`;
          } else {
            //console.log("entra en else de peluquero especifico con horarios alternativos");
            // El peluquero no está disponible, ofrecer horarios alternativos
            let horariosDisponibles =
              await MongoDB.BuscarHorariosDisponiblesPeluquero(
                this.peluquero.peluqueroID,
                fecha,
                this.duracionServicio, // Se considera la duración del servicio
                this.salonID
              );

            console.log("horariosDisponibles:", horariosDisponibles);
            if (horariosDisponibles.length > 0) {
              rtn.message = `Lo siento, el peluquero ${
                this.peluqueroNombre
              } no está disponible a las ${
                this.hora
              }. Sin embargo, está disponible a las siguientes horas: ${horariosDisponibles.join(
                ", "
              )}. ¿Te gustaría elegir alguna de estas horas?`;
              //console.log(rtn.message);
            } else {
              // Nueva funcionalidad: buscar en los próximos 7 días
              const diasDisponibles =
                await MongoDB.BuscarDisponibilidadSiguienteSemana(
                  this.peluquero.peluqueroID,
                  this.salonID,
                  this.nombreServicio,
                  this.especialidadID,
                  this.duracionServicio,
                  fecha // Fecha solicitada por el cliente
                );

              if (diasDisponibles.length > 0) {
                rtn.message = `Lo siento, el peluquero ${
                  this.peluqueroNombre
                } no está disponible en todo el día ${
                  this.fecha
                }. Sin embargo, tiene disponibilidad los siguientes días:\n\n${diasDisponibles
                  .map((dia) => `*${dia.dia}*: ${dia.horarios.join(", ")}`)
                  .join("\n")}\n\n¿Te gustaría elegir alguno de estos días?`;
              } else {
                rtn.message = `Lo siento, el peluquero ${this.peluqueroNombre} no tiene disponibilidad en todo el día ${this.fecha} ni en los próximos 7 días. ¿Te gustaría intentar con otro peluquero o elegir otro día?`;
              }
            }
          }
          //establecer nombre del peluquero
          //this.peluqueroNombre = this.peluquero.name;
        } else {
          // Si el cliente no eligió un peluquero específico, mostrar todos los disponibles a la hora solicitada
          if (peluquerosDisponibles.length > 0) {
            let nombresPeluqueros =
              await MongoDB.ObtenerNombresPeluquerosPorIDs(
                peluquerosDisponibles
              );
            rtn.message = `Estos son los peluqueros disponibles para el ${
              this.fecha
            } a las ${this.hora}: ${nombresPeluqueros.join(
              ", "
            )}. ¿Te gustaría elegir alguno o que se te asigne uno aleatoriamente?`;
            //console.log(rtn.message);
          } else {
            // Si no hay peluqueros disponibles a la hora solicitada, buscar otras horas disponibles con cualquier peluquero
            let horariosPeluquerosDisponibles =
              await MongoDB.BuscarHorariosConPeluquerosDisponibles(
                this.fecha,
                this.salonID,
                this.nombreServicio,
                this.especialidadID,
                this.duracionServicio // Se considera la duración del servicio
              );

            //console.log("horariosPeluquerosDisponibles:",horariosPeluquerosDisponibles);
            if (horariosPeluquerosDisponibles.length > 0) {
              rtn.message = `Lo siento, no hay peluqueros disponibles a las ${
                this.hora
              }. Sin embargo, estos son los horarios disponibles con otros peluqueros:\n\n${horariosPeluquerosDisponibles
                .map(
                  (horario) =>
                    `*${horario.hora}* - Peluquero: ${horario.peluqueroNombre}`
                )
                .join("\n")}. ¿Te gustaría elegir alguna de estas horas?`;
              //console.log(rtn.message);
            } else {
              rtn.message = `Lo siento, no hay peluqueros disponibles en todo el día ${this.fecha}. ¿Te gustaría intentar con otro día?`;
              //console.log(rtn.message);
            }
          }
        }
      }
    } else {
      rtn.message = "Lo siento, la fecha y hora de la cita es incorrecta.";
      await statisticsManager.incrementFailedOperations();
      await LogError(
        this.from,
        `Error al procesar Peluquero`,
        rtn.message,
        this.salonID,
        this.salonNombre
      );
    }

    DoLog(rtn.message);
    this.AddMsg(rtn);
    return "";
  }

  async ProcesarCita(gpt) {
    // Dividir el comando en partes para extraer los datos de la cita
    let partesCita = gpt.split("|");
    this.nombreServicio = partesCita[1].trim();
    let fechaHora = partesCita[2].trim();
    this.salonNombre = partesCita[3].trim();
    this.peluqueroNombre = partesCita[4].trim();
    this.nombre = partesCita[5].trim();

    let rtn = new Message(WhoEnum.System);
    let falta = [];
    let fechaIni = null;
    let fechaFin = null;
    this.peluquero = "";

    // Validación de los datos requeridos
    if (this.nombreServicio == "") {
      falta.push("Servicio");
    } else {
      this.servicioID = await ChatGPT.CalculaServicioID(this.nombreServicio);
      if (this.servicioID == "") {
        falta.push("Servicio");
      }
    }

    let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const moment = require("moment-timezone");
    let citaInicioConZona = moment.tz(fechaHora, "Europe/Madrid").format();
    let fechaHoraFin = moment
      .tz(citaInicioConZona, "Europe/Madrid")
      .add(this.duracionServicio, "minutes")
      .format();

    if (this.salonID == "") {
      falta.push("Salón");
    } else {
      let salon = await MongoDB.ObtenerSalonPorSalonID(this.salonID);
      this.salonID = salon.salonID;
      this.salonNombre = salon.nombre;
    }

    if (this.peluqueroNombre == "") {
      falta.push("Peluquero");
    } else {
      let peluqueroID = await ChatGPT.CalculaPeluquero(
        this.peluqueroNombre,
        this.salonID
      );

      for (let peluquero of peluqueros) {
        if (peluquero.peluqueroID == peluqueroID) {
          this.peluquero = peluquero;
          break;
        } else {
          this.peluquero = "";
        }
      }
      if (this.peluquero == "") {
        falta.push("Peluquero");
      }
    }

    if (this.nombre == "") {
      falta.push("Nombre cliente");
    }

    // Enviar mensaje de error si faltan datos
    if (falta.length > 0) {
      rtn.message = `Lo siento no puedo hacer la reserva de la cita porque me faltan estos datos: ${falta.join(
        ", "
      )}. Pidele estos datos al cliente.`;
      DoLog(rtn.message);
      this.AddMsg(rtn);
      return "";
    }

    // Guardar la nueva cita en la base de datos
    let saved = await MongoDB.GuardarEventoEnBD(
      this,
      citaInicioConZona,
      fechaHoraFin
    );
    try {
      if (saved) {
        rtn.message = `Comando GUARDACITA confirmado. La cita del cliente ha sido guardada en el sistema.`;
        this.citaGuardada = true;

        // Incrementar el contador de citas confirmadas y registrar éxito
        await statisticsManager.incrementConfirmedAppointments();
        await LogSuccess(
          this.from,
          "Cita guardada con éxito",
          this.salonID,
          this.salonNombre
        );

        // Si estamos en modo de modificación y se guardó la nueva cita, elimina la antigua
        //console.log("this.citaAntigua:", this.citaAntigua);
        if (this.modificacionActiva && this.citaAntigua) {
          await Appointments.updateOne(
            { _id: this.citaAntigua._id }, // Identifica la cita antigua por ID
            { $set: { status: "canceled" } } // Cambia el estado a 'canceled'
          );
          rtn.message += "La cita anterior ha sido marcada como cancelada.";
          this.modificacionActiva = false;
          this.citaAntigua = null;
          // Incrementa el contador de citas modificadas
          await statisticsManager.incrementModifiedAppointments();
        }
      } else {
        // Error en el guardado de la cita
        rtn.message = `Lo siento no puedo hacer la reserva de la cita porque hubo un error en el sistema, intenta más tarde o contacta con el salón.`;
        await statisticsManager.incrementFailedOperations();
        await LogError(
          this.from,
          `Error al guardar la cita`,
          rtn.message,
          this.salonID,
          this.salonNombre
        );
      }
    } catch (ex) {
      // Log de error con el mensaje y el stack trace del error
      await LogError(
        this.from,
        `Error al procesar la cita`,
        ex,
        this.salonID,
        this.salonNombre
      );
    }

    DoLog(rtn.message);
    this.AddMsg(rtn);
    return "";
  }

  async ProcesarCancelacionCita(gpt) {
    let partes = gpt.split(" ");
    let fecha = partes[1];

    let cancelacionExitosa = await MongoDB.BorrarCita(this.from, fecha);

    let rtn = new Message(WhoEnum.System);

    if (cancelacionExitosa) {
      rtn.message = `Tu cita ha sido cancelada con éxito.`;
      // Incrementar el contador de citas canceladas usando la clase
      await statisticsManager.incrementCanceledAppointments();
    } else {
      rtn.message = `No se pudo cancelar tu cita. Por favor, intenta nuevamente o contacta con nosotros.`;
      // Incrementar el contador de operaciones fallidas usando la clase
      await statisticsManager.incrementFailedOperations();
      await LogError(
        this.from,
        `Error al procesar la solicitud`,
        rtn.message,
        this.salonID,
        this.salonNombre
      );
    }
    DoLog(rtn.message);
    this.AddMsg(rtn);

    return "";
  }

  async ProcesarSolicitudDeHoraDeComida(gpt) {
    let comidaSolicitada = await ChatGPT.IdComida(gpt);
    let partes = comidaSolicitada.split(" ");
    let idPeluquero = partes[0];
    let horaDescanso = partes[1];
    if (moment(horaDescanso, moment.ISO_8601, true).isValid()) {
      let diaISO = moment(horaDescanso);
      let dia = diaISO.format("DD/MM/YYYY");
      let inicioComida = diaISO.format("HH:mm");
      let finComida = diaISO.add(60, "minutes");
      let terminaComida = finComida.format("HH:mm");
      let finComidaISO = finComida.format();
      let salon = MongoDB.ObtenerSalonPorSalonID(this.salonID);
      try {
        await MongoDB.MarcarPeluqueroComida(
          idPeluquero,
          inicioComida,
          finComida
        );
        let rtn = new Message(WhoEnum.System);
        rtn.message = "Tu hora de descanso ha sido reservada";
        this.AddMsg(rtn);
        return rtn.message;
      } catch (ex) {
        DoLog(
          `Error al procesar la solicitud de hora de comida: ${ex}`,
          Log.Error
        );
      }
    }
  }

  async ProcesarBajaPeluquero(gpt) {
    let partes = gpt.split(" ");
    let dia = partes[1];
    let id = partes[2];

    let rtn = new Message(WhoEnum.System);
    rtn.message = await MongoDB.MarcarPeluqueroComoNoDisponible(id, dia);
    this.AddMsg(rtn);

    this.GetFull();
    rtn = new Message(WhoEnum.ChatGPT);
    rtn.message = await ChatGPT.SendToGPT(this.full);
    this.AddMsg(rtn);

    let citas = await MongoDB.buscarCitasDePeluquero(id, dia);
    if (citas.length > 0) {
      await WhatsApp.NotificarClientesSobreCambioDeCita(citas);
    }
    return rtn.message;
  }

  async ProcesarModificacionCita(gpt) {
    let partes = gpt.split(" ");
    let fecha = partes[1];

    const modCita = await Appointments.find({
      date: fecha,
      clientPhone: this.from,
    });

    let rtn = new Message(WhoEnum.System);

    if (modCita && modCita.length > 0) {
      this.citaAntigua = JSON.parse(JSON.stringify(modCita[0])); // Almacena la cita existente
      this.modificacionActiva = true;

      this.nombreServicio = this.citaAntigua.services[0]?._id.toString() || "";
      this.salonID = this.citaAntigua.centerInfo.toString();
      this.peluqueroNombre = await MongoDB.ObtenerNombrePeluqueroPorID(
        this.citaAntigua.userInfo
      );
      this.nombre = this.citaAntigua.clientName;
      this.fecha = this.citaAntigua.date;
      this.hora = this.citaAntigua.initTime;

      rtn.message = `Esta es la cita que el cliente desea modificar: ${JSON.stringify(
        this.citaAntigua,
        null,
        2
      )}. ¿Qué desea cambiar de la cita?`;
    } else {
      rtn.message = `La cita del cliente para la fecha ${fecha} no ha sido encontrada en el sistema.`;
    }

    DoLog(rtn.message);
    this.AddMsg(rtn);
    return "";
  }

  async ProcesarInfoCentro(gpt) {
    // Extraer el nombre del centro desde el comando
    const partes = gpt.split(" ");
    const nombreCentro = partes.slice(1).join(" ").trim(); // Guardar nombre en variable centro
    let centroID = "";

    //console.log("nombreCentro:", nombreCentro);

    let rtn = new Message(WhoEnum.System);

    try {
      // Obtener el ID del centro utilizando CalculaCentroID con el nombre
      centroID = await ChatGPT.CalculaCentroID(nombreCentro);

      //console.log("centroID:", centroID);

      if (centroID) {
        // Buscar la información del centro en la lista de salones usando el centroID
        const centroInfo = salones.find((salon) => salon.salonID === centroID);

        if (centroInfo) {
          //console.log("centroInfo:", centroInfo);
          // Formatear la información del centro
          rtn.message = `Información del Centro:\n*Nombre:* ${centroInfo.nombre}\n*Dirección:* ${centroInfo.address}\n*Teléfono:* ${centroInfo.phoneNumber}`;
        } else {
          rtn.message = `No se encontró información para el centro con nombre "${nombreCentro}".`;
        }
      } else {
        rtn.message = `No se pudo identificar el centro con el nombre "${nombreCentro}".`;
      }
    } catch (ex) {
      DoLog(`Error al obtener la información del centro: ${ex}`, Log.Error);
      await LogError(
        this.from,
        `Error al procesar la solicitud de información del centro`,
        ex,
        this.salonID,
        this.salonNombre
      );
      rtn.message =
        "Hubo un error al obtener la información del centro. Por favor, intente nuevamente más tarde.";
    }

    DoLog(rtn.message);
    this.AddMsg(rtn);
    return "";
  }
  
  async ProcesarConsultarHorario(gpt) {
    console.log("\n=== INICIO PROCESAR CONSULTAR HORARIO ===");
    let partes = gpt.replace("CONSULTHOR", "").trim().split(/\s+/);
    let fecha = partes[0];
    let nombrePeluquero = partes[1] === "MOREINFO" ? "" : partes.slice(1).join(" ");
    this.salonID = "665f640d47675f27f8647ca1";
    
    console.log("Fecha recibida:", fecha);
    console.log("Nombre peluquero:", nombrePeluquero || "MOREINFO");
    console.log("SalonID:", this.salonID);
    
    
    let rtn = new Message(WhoEnum.System);

    if (!moment(fecha, moment.ISO_8601, true).isValid() || !this.salonID) {
        console.log("Validación fallida:", {
            fechaValida: moment(fecha, moment.ISO_8601, true).isValid(),
            salonPresente: Boolean(this.salonID)
        });
        rtn.message = !this.salonID ? "Lo siento, falta conocer el salón." : "La fecha proporcionada no es válida.";
        this.AddMsg(rtn);
        return "";
    }

    try {
        if (nombrePeluquero.toUpperCase().includes("MOREINFO")) {
            console.log("\n=== PROCESANDO MOREINFO ===");
            const peluquerosDelSalon = peluqueros.filter(p => p.salonID === this.salonID);
            console.log("Peluqueros encontrados en el salón:", peluquerosDelSalon.length);
            
            let peluquerosHorarios = [];
            let fechaConsulta = moment(fecha);
            
            for (let peluquero of peluquerosDelSalon) {
                console.log("\nProcesando peluquero:", peluquero.name);
                let horariosDisponibles = [];
                let horarioEncontrado = false;

                let citasFueraHorario = await Appointments.find({
                    userInfo: new ObjectId(peluquero.peluqueroID),
                    centerInfo: new ObjectId(this.salonID),
                    date: moment(fecha).format("MM/DD/YYYY"),
                    clientName: "Fuera de horario",
                    status: "confirmed"
                }).sort({ initTime: 1 });

                console.log("Citas fuera de horario encontradas:", citasFueraHorario.length);
                console.log("Detalle citas:", JSON.stringify(citasFueraHorario, null, 2));

                if (citasFueraHorario.length >= 2) {
                    console.log("Procesando 2+ citas fuera de horario");
                    horariosDisponibles.push({
                        fecha: fechaConsulta.format("DD/MM/YYYY"),
                        inicio: moment(citasFueraHorario[0].finalTime, "HH:mm:ss").format("HH:mm"),
                        fin: moment(citasFueraHorario[1].initTime, "HH:mm:ss").format("HH:mm")
                    });
                    horarioEncontrado = true;
                } else if (citasFueraHorario.length === 1) {
                    console.log("Procesando 1 cita fuera de horario");
                    const citaFH = citasFueraHorario[0];
                    if (moment(citaFH.initTime, "HH:mm:ss").format("HH:mm") === "10:00") {
                        horariosDisponibles.push({
                            fecha: fechaConsulta.format("DD/MM/YYYY"),
                            inicio: moment(citaFH.finalTime, "HH:mm:ss").format("HH:mm"),
                            fin: "22:00"
                        });
                    } else {
                        horariosDisponibles.push({
                            fecha: fechaConsulta.format("DD/MM/YYYY"),
                            inicio: "10:00",
                            fin: moment(citaFH.initTime, "HH:mm:ss").format("HH:mm")
                        });
                    }
                    horarioEncontrado = true;
                }

                console.log("Horarios disponibles encontrados:", horariosDisponibles);

                if (horarioEncontrado) {
                    peluquerosHorarios.push({
                        nombre: peluquero.name,
                        horarios: horariosDisponibles
                    });
                }
            }

            console.log("\nResumen final peluqueros con horarios:", peluquerosHorarios);

            if (peluquerosHorarios.length > 0) {
                const horariosList = peluquerosHorarios
                    .map(p => `*${p.nombre}*: ${p.horarios.map(h => 
                        `de ${h.inicio} a ${h.fin}`
                    ).join(", ")}`)
                    .join("\n");
                    
                rtn.message = `Horarios de los peluqueros para el ${moment(fecha).format("DD/MM/YYYY")}:\n\n${horariosList}\n\n¿Te gustaría agendar una cita con alguno de ellos?`;
            } else {
                rtn.message = `Lo siento, no hay peluqueros registrados para trabajar el ${moment(fecha).format("DD/MM/YYYY")}.`;
            }
        } else {
            console.log("\n=== PROCESANDO PELUQUERO ESPECÍFICO ===");
            let peluqueroID = await ChatGPT.CalculaPeluquero(nombrePeluquero, this.salonID);
            console.log("ID del peluquero encontrado:", peluqueroID);

            if (!peluqueroID) {
                rtn.message = `No se encontró al peluquero "${nombrePeluquero}".`;
                this.AddMsg(rtn);
                return "";
            }

            let fechaConsulta = moment(fecha);
            let horarioEncontrado = false;
            let horariosDisponibles = [];

            for (let i = 0; i <= 7; i++) {
                console.log(`\nBuscando día ${i}: ${fechaConsulta.format("DD/MM/YYYY")}`);
                const fechaFormateada = fechaConsulta.format("MM/DD/YYYY");
                
                let citasFueraHorario = await Appointments.find({
                    userInfo: new ObjectId(peluqueroID),
                    centerInfo: new ObjectId(this.salonID),
                    date: fechaFormateada,
                    clientName: "Fuera de horario",
                    status: "confirmed"
                }).sort({ initTime: 1 });

                console.log("Citas fuera de horario encontradas:", citasFueraHorario.length);
                console.log("Detalle citas:", JSON.stringify(citasFueraHorario, null, 2));

                if (citasFueraHorario.length >= 2) {
                    console.log("Procesando 2+ citas fuera de horario");
                    horariosDisponibles.push({
                        fecha: fechaConsulta.format("DD/MM/YYYY"),
                        inicio: moment(citasFueraHorario[0].finalTime, "HH:mm:ss").format("HH:mm"),
                        fin: moment(citasFueraHorario[1].initTime, "HH:mm:ss").format("HH:mm")
                    });
                    horarioEncontrado = true;
                } else if (citasFueraHorario.length === 1) {
                    console.log("Procesando 1 cita fuera de horario");
                    const citaFH = citasFueraHorario[0];
                    if (moment(citaFH.initTime, "HH:mm:ss").format("HH:mm") === "10:00") {
                        horariosDisponibles.push({
                            fecha: fechaConsulta.format("DD/MM/YYYY"),
                            inicio: moment(citaFH.finalTime, "HH:mm:ss").format("HH:mm"),
                            fin: "22:00"
                        });
                    } else {
                        horariosDisponibles.push({
                            fecha: fechaConsulta.format("DD/MM/YYYY"),
                            inicio: "10:00",
                            fin: moment(citaFH.initTime, "HH:mm:ss").format("HH:mm")
                        });
                    }
                    horarioEncontrado = true;
                }

                if (horarioEncontrado && i === 0) {
                    console.log("Horario encontrado para el día solicitado");
                    let horario = horariosDisponibles[0];
                    rtn.message = `${nombrePeluquero} trabaja de ${horario.inicio} a ${horario.fin} el ${horario.fecha}. ¿Te gustaría agendar una cita?`;
                    break;
                } else if (i === 7 && horariosDisponibles.length > 0) {
                    console.log("Horarios encontrados para próximos días");
                    let horariosMsg = horariosDisponibles
                        .map(h => `*${h.fecha}*: de ${h.inicio} a ${h.fin}`)
                        .join("\n");
                    rtn.message = `${nombrePeluquero} no está disponible el ${moment(fecha).format("DD/MM/YYYY")}. Sin embargo, tiene los siguientes horarios:\n\n${horariosMsg}\n\n¿Te gustaría agendar alguno de estos días?`;
                }

                if (!horarioEncontrado) {
                    fechaConsulta.add(1, 'days');
                }
            }

            if (!horarioEncontrado) {
                console.log("No se encontraron horarios en los próximos 7 días");
                rtn.message = `${nombrePeluquero} no tiene horarios registrados en los próximos 7 días.`;
            }
        }
    } catch (ex) {
        console.error("Error en ProcesarConsultarHorario:", ex);
        DoLog(`Error en ProcesarConsultarHorario: ${ex}`, Log.Error);
        rtn.message = `Hubo un error al consultar los horarios.`;
    }

    console.log("\nMensaje final:", rtn.message);
    console.log("=== FIN PROCESAR CONSULTAR HORARIO ===\n");
    
    this.AddMsg(rtn);
    return "";
  }

}

class Message {
  constructor(who = WhoEnum.None) {
    this.type = "";
    this.msg_id = "";
    this.newID = false;
    this.audio = false;
    this.message = "";
    this.rawMsg = "";
    this.GPT = GPTEnum.NONE;
    this.who = who;
  }

  InitFromReq(req) {
    let value = req?.body?.entry?.[0]?.changes[0]?.value ?? null;
    let msg_obj = value?.messages?.[0] ?? null;
    this.InitFromMsgObj(msg_obj);
  }

  InitFromMsgObj(msg_obj) {
    this.type = msg_obj?.type ?? "";
    this.msg_id = msg_obj?.id ?? "";
    this.audio = msg_obj?.audio ?? false;
    this.message = msg_obj?.text?.body?.trim() ?? "";
    if (this.type == "button") {
      this.message = msg_obj?.button?.text?.trim() ?? "";
      DoLog(`Boton "${this.message}" pulsado.`, Log.Log);
    }
    this.message = this.message
      .replace("[", "(")
      .replace("]", ")")
      .replace("~", "-");
  }

  Init(message, msg_id = "") {
    this.msg_id = msg_id ?? "";
    this.message = message ?? "";
  }

  SetGPT() {
    this.GPT = GPTEnum.NONE;
    for (const [key, value] of Object.entries(GPTEnum)) {
      if (key != "NONE") {
        if (this.message.includes(value)) {
          this.GPT = value;
          break;
        }
      }
    }
    return this.GPT;
  }
}

class MongoDB {
  static async ObtenerSalonPorSalonID(salonID) {
    let rtn = null;
    if (salonID) {
      let salon = salones.find((salon) => salon.salonID == salonID.toString());
      rtn = salon ?? null;
    }
    return rtn ?? { salonID: "", nombre: "", addess: "" };
  }

  static EsMixto(salonID) {
    let rtn = false;
    let isXX = false;
    let isXY = false;
    for (let salon of salones) {
      if (salon.salonID == salonID) {
        for (let especialidadID of salon.specialities) {
          let name = MongoDB.GetEspecialidadName(especialidadID);
          if (name.toUpperCase() == "SEÑORA") {
            isXX = true;
          } else if (name.toUpperCase() == "CABALLERO") {
            isXY = true;
          }
        }
      }
    }
    rtn = isXX && isXY;
    return rtn;
  }

  static GetEspecialidadName(especialidadID) {
    let rtn = "";
    for (let especialidad of especialidades) {
      if (especialidad.especialidadID == especialidadID) {
        rtn = especialidad.name;
        return rtn;
      }
    }
    return rtn;
  }

  static PeluqueroTieneServicio(peluquero, serviciosSolicitados) {
    //console.log(`Revisando servicios del peluquero: ${peluquero.name}`);
    //console.log(`Servicios del peluquero: ${JSON.stringify(peluquero.services)}`);
    //console.log(`Servicios solicitados: ${JSON.stringify(serviciosSolicitados)}`);

    // Asegúrate de que serviciosSolicitados es un array
    serviciosSolicitados = Array.isArray(serviciosSolicitados)
      ? serviciosSolicitados
      : [serviciosSolicitados];

    // Convertimos los servicios del peluquero a sus IDs
    let serviciosDelPeluqueroIDs = peluquero.services
      .map((servicio) => {
        let servicioInfo = servicios.find((s) => s.servicio === servicio);
        return servicioInfo ? servicioInfo.servicioID : null;
      })
      .filter((id) => id !== null);

    //console.log(`IDs de servicios del peluquero: ${JSON.stringify(serviciosDelPeluqueroIDs)}`);

    // Verificamos si el peluquero tiene todos los servicios solicitados
    let tieneServicio = serviciosSolicitados.every((servicioID) => {
      //console.log(`Comparando servicio solicitado: ${servicioID}`);

      let resultado = serviciosDelPeluqueroIDs.includes(servicioID);
      //console.log(`Resultado de la comparación para ${peluquero.name}: ${resultado}`);
      return resultado;
    });

    //console.log(`El peluquero ${peluquero.name} tiene todos los servicios solicitados: ${tieneServicio}`);
    return tieneServicio;
  }

  static PeluqueroTieneEspecialidad(peluquero, especialidadID) {
    let rtn = false;
    //console.log("entra en PeluqueroTieneEspecialidad");
    //console.log("peluquero.specialties", peluquero.specialties);
    if (especialidadID == "") {
      rtn = true;
    } else {
      for (let especialidad of peluquero.specialities) {
        //console.log("especialidad:", especialidad)
        if (especialidad == especialidadID) {
          rtn = true;
          return rtn;
        }
      }
    }
    return rtn;
  }

  static async ListarPeluquerosDisponibles(
    fecha,
    salonID,
    nombreServicio,
    especialidadID,
    duracionServicio
  ) {
    //console.log("entra en ListarPeluquerosDisponibles");
    let rtn = [];
    let fechaEvento = moment(fecha);
    let fechaPeluqFormatoMongo = fechaEvento.format("MM/DD/YYYY");

    /*console.log("fecha:", fecha);
    console.log("fechaEvento:", fechaEvento);
    console.log("fechaPeluqFormatoMongo:", fechaPeluqFormatoMongo);
    console.log("nombreServicio:", nombreServicio);
    console.log("salonID:", salonID);
    */

    // Convertimos nombreServicio en un array
    let serviciosSolicitados = Array.isArray(nombreServicio)
      ? nombreServicio
      : [nombreServicio];
    //console.log("Servicios solicitados:", serviciosSolicitados);

    try {
      for (let peluquero of peluqueros) {
        if (peluquero.salonID == salonID) {
          if (MongoDB.PeluqueroTieneServicio(peluquero, nombreServicio)) {
            if (MongoDB.PeluqueroTieneEspecialidad(peluquero, especialidadID)) {
              let disponibilidad =
                await MongoDB.VerificarDisponibilidadPeluquero(
                  peluquero.peluqueroID,
                  fecha,
                  salonID,
                  duracionServicio
                );
              //console.log("disponibilidad",disponibilidad);
              if (disponibilidad.disponible) {
                //console.log("peluquero disponible: ", peluquero.peluqueroID);
                rtn.push(peluquero.peluqueroID);
              }
            }
          }
        }
      }
    } catch (ex) {
      DoLog(`Error al listar peluqueros disponibles: ${ex}`, Log.Error);
      await LogError(
        this.from,
        `Error al listar peluqueros disponibles`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      throw ex;
    }
    return rtn;
  }

  static async VerificarDisponibilidadPeluquero(
    peluqueroID,
    fecha,
    salonID,
    duracionServicio
  ) {
    //console.log("VerificarDisponibilidadPeluquero");
    //console.log("VerificarDisponibilidadPeluquero fecha que recibe:", fecha);
    let rtn = {
      disponible: false,
      horaEntrada: null,
      horaSalida: null,
      horariosDisponibles: null,
    };
    try {
      let fechaHoraEvento = moment(fecha);

      let fechaPeluqFormatoMongo = fechaHoraEvento.format("MM/DD/YYYY");

      let horaCita = fechaHoraEvento.tz("Europe/Madrid").format("HH:mm");
      //console.log("VerificarDisponibilidadPeluquero horaCita:", horaCita);

      let horaFinCita = fechaHoraEvento
        .clone()
        .add(duracionServicio, "minutes")
        .tz("Europe/Madrid")
        .format("HH:mm");
      //console.log("VerificarDisponibilidadPeluquero horaFINCita:", horaFinCita);

      const initTimeMoment = moment(horaCita, "HH:mm");
      const finalTimeMoment = moment(horaFinCita, "HH:mm");

      //console.log("fechaPeluqFormatoMongo:", fechaPeluqFormatoMongo);
      //console.log("peluqueroID:", peluqueroID);
      //console.log("salonID:", salonID);

      let listaCitas = await Appointments.find({
        date: fechaPeluqFormatoMongo,
        userInfo: new ObjectId(peluqueroID),
        centerInfo: new ObjectId(salonID),
      });

      //console.log("listaCitas:", listaCitas);
      for (let cita of listaCitas) {
        const citaInitTime = moment(cita.initTime, "HH:mm");
        const citaFinalTime = moment(cita.finalTime, "HH:mm");
        if (
          initTimeMoment.isBefore(citaFinalTime) &&
          finalTimeMoment.isAfter(citaInitTime)
        ) {
          //console.log("Peluquero no disponible:",peluqueroID,citaInitTime,citaFinalTime,fechaPeluqFormatoMongo);
          return rtn;
        }
      }
      rtn.disponible = true;
      rtn.horaEntrada = horaCita;
      rtn.horaSalida = horaFinCita;
      /*console.log(
        "Peluquero SI disponible:",
        peluqueroID,
        horaCita,
        horaFinCita,
        fechaPeluqFormatoMongo
      );*/
      return rtn;
    } catch (ex) {
      DoLog(
        `Error al verificar la disponibilidad del peluquero: ${ex}`,
        Log.Error
      );
      await LogError(
        this.from,
        `Error al verificar peluqueros disponibles`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      throw ex;
    }
  }

  static async ObtenerNombresPeluquerosPorIDs(idsPeluquero) {
    let rtn = [];
    try {
      let promesasNombres = idsPeluquero.map((idPeluquero) =>
        MongoDB.ObtenerNombrePeluqueroPorID(idPeluquero)
      );
      let nombresPeluqueros = await Promise.all(promesasNombres);
      rtn = nombresPeluqueros.filter((nombre) => nombre != null);
    } catch (ex) {
      DoLog(`Error al obtener los nombres de los peluqueros: ${ex}`, Log.Error);
    }
    return rtn;
  }

  static async ObtenerNombrePeluqueroPorID(peluqueroID) {
    try {
      for (let peluquero of peluqueros) {
        if (peluquero.peluqueroID == peluqueroID) {
          return peluquero.name;
        }
      }
    } catch (ex) {
      DoLog(`Error al leer el archivo de peluqueros: ${ex}`, Log.Error);
    }
    return null;
  }

  static async MarcarPeluqueroComoNoDisponible(id, dia) {
    let rtn = { success: false, message: "" };
    let fechaISO = moment(dia);
    let fecha = fechaISO.format("DD/MM/YYYY");
    let inicioCita = "00:00";
    let finCita = "23:59";
    const evento = new Appointments({
      clientName: "BAJA",
      clientPhone: "",
      fecha: fecha,
      horaInicio: inicioCita,
      horaFin: finCita,
      userInto: new ObjectId(id),
    });
    try {
      await evento.save();
      rtn.success = true;
      rtn.message = `Peluquero ${id} marcado como no disponible para ${dia}.`;
    } catch (ex) {
      DoLog(`Error al guardar el evento en MongoDB:${ex}`, Log.Error);
      rtn.success = false;
      rtn.message = "Error al procesar la solicitud. Inténtalo de nuevo.";
    }
    return rtn;
  }

  static async MarcarPeluqueroComida(id, inicioComida, finComida) {
    let rtn = { success: false, message: "" };
    let fechaISO = moment(inicioComida);
    let fecha = fechaISO.format("DD/MM/YYYY");
    let inicioCita = fechaISO.tz("Europe/Madrid").format("HH:mm");
    let fin = moment(finComida);
    let finCita = fin.tz("Europe/Madrid").format("HH:mm");
    const evento = new Appointments({
      clientName: "Hora de Comida",
      clientPhone: "",
      fecha: fecha,
      horaInicio: inicioCita,
      horaFin: finCita,
      userInto: new ObjectId(id),
      services: ["Hora de Comida"],
    });
    try {
      await evento.save();
      rtn.success = true;
      rtn.message = `Peluquero ${id} reservada comida para ${fecha}.`;
    } catch (ex) {
      DoLog(`Error al guardar el evento en MongoDB:${ex}`, Log.Error);
      rtn.success = false;
      rtn.message = "Error al procesar la solicitud. Inténtalo de nuevo.";
    }
    return rtn;
  }

  static async BuscarCitasDePeluquero(id, dia) {
    let fechaEvento = moment(dia).format("DD/MM/YYYY");
    let rtn = [];
    try {
      rtn = await Appointments.find({
        userInfo: ObjectId(id),
        date: fechaEvento,
      });
    } catch (ex) {
      DoLog(`Error al buscar citas del peluquero: ${ex}`, Log.Error);
      await LogError(
        this.from,
        `Error al buscar citas del peluquero`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      rtn = [];
    }
    return rtn;
  }

  static async BorrarCita(from, fecha) {
    let rtn = false;
    console.log("entra e borrarCita()");
    try {
      // Buscar una reserva que coincida con la fecha y el número de teléfono
      let cita = await Appointments.findOne({
        date: fecha,
        clientPhone: from,
      });
      console.log("cita:", cita);

      if (cita) {
        // Actualizar el status de la cita a "canceled"
            await Appointments.updateOne(
                { _id: cita._id },
                { $set: { status: "canceled" } }
            );
        rtn = true;
        console.log("cita se ha marcado como cancelada");
      } else {
        rtn = false;
        console.log("cita no se ha borrado");
      }
    } catch (ex) {
      DoLog(`Error al borrar el evento en MongoDB:${ex}`, Log.Error);
      await LogError(
        this.from,
        `Error al borrar la cita`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      rtn = false;
    }
    //console.log("rtn:", rtn);
    return rtn;
  }

  static async GuardarEventoEnBD(curr, horaInicio, horaFin) {
    let rtn = false;
    let fechaISO = moment(horaInicio);
    let fecha = fechaISO.format("MM/DD/YYYY");
    let inicioCita = fechaISO.tz("Europe/Madrid").format("HH:mm");
    let fin = moment(horaFin);
    let finCita = fin.tz("Europe/Madrid").format("HH:mm");
    try {
      let serviciosParaGuardar = [];

      // Separar el string curr.servicioID en los diferentes IDs utilizando comas
      let ids = curr.servicioID.split(",").map((id) => id.trim());

      for (let servicioID of ids) {
        // Encontrar el servicio correspondiente en la lista de servicios
        let servicio = servicios.find((s) => s.servicioID === servicioID);
        if (servicio) {
          serviciosParaGuardar.push({
            _id: new ObjectId(servicio.servicioID), // Asegurar conversión a ObjectId
            serviceName: servicio.servicio,
            duration: servicio.duracion,
            color: servicio.color,
          });
        }
      }

      if (serviciosParaGuardar.length === 0) {
        throw new Error("No se encontraron servicios válidos para guardar.");
      }

      /*
      console.log("curr.nombre:", curr.nombre);
      console.log("curr.from:", curr.from);
      console.log("fecha:", fecha);
      console.log("inicioCita:", inicioCita);
      console.log("finCita:", finCita);
      console.log("curr.peluquero:", curr.peluquero);
      console.log("curr.peluquero.peluqueroID:", curr.peluquero.peluqueroID);
      console.log("curr.salonID:", curr.salonID);
      console.log("serviciosParaGuardar:", serviciosParaGuardar);
      */

      const evento = new Appointments({
        clientName: curr.nombre,
        clientPhone: curr.from,
        date: fecha,
        initTime: inicioCita,
        finalTime: finCita,
        userInfo: new ObjectId(curr.peluquero.peluqueroID), // Asegurar conversión a ObjectId
        centerInfo: new ObjectId(curr.salonID), // Asegurar conversión a ObjectId
        services: serviciosParaGuardar, // Guardar todos los servicios encontrados
      });

      //console.log(evento);

      await evento.save();
      rtn = true;
    } catch (ex) {
      DoLog(`Error al guardar el evento en MongoDB:${ex}`, Log.Error);
      await LogError(
        this.from,
        `Error al guardar evento`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      rtn = false;
    }
    return rtn;
  }

  static async BuscarHorariosDisponiblesPeluquero(
    peluqueroID,
    fecha,
    duracionServicio,
    salonID
  ) {
    //console.log("Iniciando búsqueda de horarios disponibles para el peluquero.");

    let horariosDisponibles = [];
    let horarioApertura = moment("10:00", "HH:mm"); // Hora de apertura: 10:00
    let horarioCierre = moment("22:00", "HH:mm"); // Hora de cierre: 22:00

    // Obtener la hora actual en Madrid
    let horaActualMadrid = moment().tz("Europe/Madrid");

    try {
      // Obtener todas las citas para ese peluquero en el día solicitado
      let citasDelDia = await Appointments.find({
        userInfo: new ObjectId(peluqueroID),
        centerInfo: new ObjectId(salonID),
        date: moment(fecha).format("MM/DD/YYYY"),
      });
      console.log(
        "Citas del peluquero:",
        peluqueroID,
        citasDelDia.length,
        fecha
      );

      // Ordenar las citas por hora de inicio
      citasDelDia.sort((a, b) =>
        moment(a.initTime, "HH:mm").diff(moment(b.initTime, "HH:mm"))
      );
      console.log("Citas del día ordenadas:", citasDelDia);

      let ultimaHoraFin = horarioApertura;

      // Iterar sobre cada cita para encontrar huecos disponibles
      for (let cita of citasDelDia) {
        let horaInicioCita = moment(cita.initTime, "HH:mm");
        let horaFinCita = moment(cita.finalTime, "HH:mm");

        // Verificación para evitar horas fuera de orden o superpuestas
        if (
          horaInicioCita.isBefore(horarioApertura) ||
          horaInicioCita.isAfter(horarioCierre) ||
          horaInicioCita.isSame(horarioCierre)
        ) {
          console.log(
            `La cita en ${horaInicioCita.format(
              "HH:mm"
            )} está fuera del horario de apertura.`
          );
          continue;
        }

        /*console.log(
          `Verificando espacio entre ${ultimaHoraFin.format(
            "HH:mm"
          )} y ${horaInicioCita.format("HH:mm")}`
        );*/

        // Si hay una franja horaria libre entre el final de la última cita y el inicio de la siguiente
        if (ultimaHoraFin.isSameOrBefore(horaInicioCita)) {
          let horaFinServicio = ultimaHoraFin
            .clone()
            .add(duracionServicio, "minutes");

          console.log(
            `Posible horario disponible: ${ultimaHoraFin.format(
              "HH:mm"
            )} a ${horaFinServicio.format("HH:mm")}`
          );

          // Verificar si la franja es lo suficientemente larga para el servicio y si es una hora futura
          if (horaFinServicio.isSameOrBefore(horaInicioCita)) {
            // Dividir la franja en intervalos de 30 minutos y agregar cada uno
            while (
              ultimaHoraFin.isBefore(horaInicioCita) &&
              ultimaHoraFin
                .clone()
                .add(duracionServicio, "minutes")
                .isSameOrBefore(horaInicioCita)
            ) {
              horariosDisponibles.push(`${ultimaHoraFin.format("HH:mm")}`);
              ultimaHoraFin.add(duracionServicio, "minutes"); // Avanzar en intervalos de 30 minutos
            }
          }
        }

        // Actualizar la última hora de finalización a la hora de fin de la cita actual
        ultimaHoraFin = horaFinCita;
      }

      // Si hay un espacio libre entre la última cita y el cierre del salón
      let horaFinServicio = ultimaHoraFin
        .clone()
        .add(duracionServicio, "minutes");

      /* console.log(
        `Verificando espacio final hasta cierre: ${ultimaHoraFin.format(
          "HH:mm"
        )} a ${horarioCierre.format("HH:mm")}`
      );*/

      // Solo verificar si la última hora de fin es menor que la hora de cierre
      if (ultimaHoraFin.isSameOrBefore(horarioCierre)) {
        // Dividir el espacio libre en intervalos de 30 minutos hasta la hora de cierre
        while (
          ultimaHoraFin.isBefore(horarioCierre) &&
          ultimaHoraFin
            .clone()
            .add(duracionServicio, "minutes")
            .isSameOrBefore(horarioCierre)
        ) {
          horariosDisponibles.push(`${ultimaHoraFin.format("HH:mm")}`);
          ultimaHoraFin.add(duracionServicio, "minutes"); // Avanzar en intervalos de 30 minutos
        }
      } else {
        //console.log("No hay más espacios disponibles hasta el cierre.");
      }
    } catch (ex) {
      DoLog(
        `Error al buscar horarios disponibles para el peluquero: ${ex}`,
        Log.Error
      );
      await LogError(
        this.from,
        `Error al buscar horarios disponibles para el peluquero`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      throw ex;
    }

    //console.log("Horarios disponibles:", horariosDisponibles);
    return horariosDisponibles;
  }

  static async BuscarHorariosConPeluquerosDisponibles(
    fecha,
    salonID,
    nombreServicio,
    especialidadID,
    duracionServicio
  ) {
    //console.log("entra en BuscarHorariosConPeluquerosDisponibles");
    let horariosDisponiblesConPeluquero = [];
    let horarioApertura = moment(fecha).set({ hour: 10, minute: 0 }); // Hora de apertura: 10:00
    let horarioCierre = moment(fecha).set({ hour: 22, minute: 0 }); // Hora de cierre: 22:00

    try {
      // Obtener la lista de peluqueros del salón
      let listaPeluqueros = peluqueros.filter(
        (peluquero) => peluquero.salonID == salonID
      );

      //console.log("listaPeluqueros:", listaPeluqueros);
      // Buscar las franjas horarias disponibles de cada peluquero en el día solicitado
      for (let peluquero of listaPeluqueros) {
        if (MongoDB.PeluqueroTieneServicio(peluquero, nombreServicio)) {
          if (MongoDB.PeluqueroTieneEspecialidad(peluquero, especialidadID)) {
            let horariosDisponibles =
              await MongoDB.BuscarHorariosDisponiblesPeluquero(
                peluquero.peluqueroID,
                fecha,
                duracionServicio,
                salonID
              );
            // Agregar la hora de inicio disponible solo si la franja es suficiente para el servicio
            for (let horario of horariosDisponibles) {
              //console.log("Comprobamos horario:", horario);
              let [horaInicio, horaFin] = horario.split(" - "); // Dividir franja en hora de inicio y fin
              let inicio = moment(horaInicio, "HH:mm");
              let fin = moment(horaFin, "HH:mm");
              // Calcular la hora de fin en función de la duración del servicio
              let horaFinServicio = inicio
                .clone()
                .add(duracionServicio, "minutes");

              // Solo agregar el horario si hay tiempo suficiente para el servicio
              /*console.log(
                "Comprobamos huecos:",
                peluquero.name,
                horaFinServicio,
                fin
              );*/
              //if (
              //   horaFinServicio.isBefore(fin) ||
              //   horaFinServicio.isSame(fin)
              //  ) {
              horariosDisponiblesConPeluquero.push({
                hora: inicio.format("HH:mm"),
                peluqueroNombre: peluquero.name,
              });
              //   }
            }
          }
        }
      }

      // Ordenar los horarios disponibles por hora
      horariosDisponiblesConPeluquero.sort((a, b) =>
        moment(a.hora, "HH:mm").diff(moment(b.hora, "HH:mm"))
      );
    } catch (ex) {
      DoLog(
        `Error al buscar horarios con peluqueros disponibles: ${ex}`,
        Log.Error
      );
      await LogError(
        this.from,
        `Error al buscar horarios con peluqueros disponibles`,
        ex,
        this.salonID,
        this.salonNombre
      );
      await statisticsManager.incrementFailedOperations();
      throw ex;
    }
    return horariosDisponiblesConPeluquero;
  }

  static async BuscarDisponibilidadSiguienteSemana(
    peluqueroID,
    salonID,
    nombreServicio,
    especialidadID,
    duracionServicio,
    fechaInicio,
    diasMaximos = 7
  ) {
    const diasDisponibles = [];
    const fechaBase = moment(fechaInicio, "YYYY-MM-DD");

    try {
      for (let i = 1; i <= diasMaximos; i++) {
        const fecha = fechaBase.clone().add(i, "days");
        const horariosDisponibles =
          await MongoDB.BuscarHorariosDisponiblesPeluquero(
            peluqueroID,
            fecha,
            duracionServicio,
            salonID
          );

        console.log("horariosDisponibles:", horariosDisponibles);
        if (horariosDisponibles.length > 0) {
          diasDisponibles.push({
            dia: fecha.format("DD/MM/YYYY"),
            horarios: horariosDisponibles,
          });
        }
      }
    } catch (ex) {
      DoLog(
        `Error al buscar días con disponibilidad en los próximos días: ${ex}`,
        Log.Error
      );
      throw ex;
    }

    return diasDisponibles;
  }
}

class WhatsApp {
  static async Responder(phone_number_id, from, body, msg_id = null) {
    if (from ?? "" != "") {
      let data = {
        messaging_product: "whatsapp",
        to: from,
        text: { body: body },
      };
      if (msg_id ?? "" != "") {
        data.context = {
          message_id: msg_id,
        };
      }
      await WhatsApp.Send(phone_number_id, data);
    }
  }

  static async MarkRead(phone_number_id, ids) {
    for (let i = 0; i < ids.length; ++i) {
      let data = {
        messaging_product: "whatsapp",
        status: "read",
        message_id: ids[i],
      };
      await WhatsApp.Send(phone_number_id, data);
    }
  }

  static async Send(phone_number_id, data) {
    for (let i = 1; i <= 3; ++i) {
      try {
        if (phone_number_id ?? "" != "") {
          const response = await axios({
            method: "POST",
            url: `https://graph.facebook.com/v18.0/${phone_number_id}/messages`,
            headers: {
              Authorization: `Bearer ${GRAPH_API_TOKEN}`,
            },
            data: data,
          });
          //console.log('Respuesta exitosa de WhatsApp:', response.data);
        }
        return;
      } catch (error) {
        if (error.response) {
          console.error("Error en la respuesta del servidor:", {
            status: error.response.status,
            data: error.response.data,
            headers: error.response.headers,
          });
        } else if (error.request) {
          console.error("No hubo respuesta de WhatsApp:", error.request);
        } else {
          console.error("Error al configurar la solicitud:", error.message);
        }
        DoLog(
          `Error al enviar datos por WhatsApp intenti ${i}: ${error}`,
          Log.Error
        );
      }
      sleep(100);
    }
  }

  static async NotificarClientesSobreCambioDeCita(
    phone_number_id,
    from,
    citas
  ) {
    for (const cita of citas) {
      let cliente = cita.nombreCliente.substring(22).trim();
      WhatsApp.SendTemplateBaja(phone_number_id, from, cliente, cita.fecha);
    }
  }

  static async SendTemplateBaja(phone_number_id, from, cliente, fecha) {
    let data = {
      messaging_product: "whatsapp",
      to: from,
      type: "template",
      template: {
        name: "baja",
        language: {
          code: "es",
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: cliente,
              },
              {
                type: "text",
                text: fecha,
              },
            ],
          },
        ],
      },
    };
    await WhatsApp.Send(phone_number_id, data);
  }

  static async SendButton(phone_number_id, from) {
    let data = {
      messaging_product: "whatsapp",
      to: from,
      type: "template",
      template: {
        name: "hi",
        language: {
          code: "es",
        },
        components: [
          {
            type: "body",
          },
        ],
      },
    };
    await WhatsApp.Send(phone_number_id, data);
  }

  static async SendTemplateRecordatorio(
    phone_number_id,
    from,
    clientName,
    dia,
    hora
  ) {
    let data = {
      messaging_product: "whatsapp",
      to: from,
      type: "template",
      template: {
        name: "recordatorio_cita",
        language: {
          code: "es",
        },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: clientName,
              },
              {
                type: "text",
                text: dia,
              },
              {
                type: "text",
                text: hora,
              },
            ],
          },
        ],
      },
    };

    /*
    
 components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: clientName,
              },
              {
                type: "text",
                text: salonName,
              },
              {
                type: "text",
                text: serviceName,
              },
            ],
          },
        ],    
    
    
    */

    await WhatsApp.Send(phone_number_id, data);
  }

  /*static async SendTemplateEncuesta(phone_number_id, from) {
    let data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: from,
      type: "template",
      template: {
        name: "encuestabot2",
        language: {
          code: "es",
        },
        components: [
          {
            type: "button",
            sub_type: "flow",
            index: "0",
            parameters: [
              {
                type: "action",
                action: {
                  flow_action_data: {
                    flow_id: "2545481272506416",
                    navigate_screen: "RECOMMEND",
                  },
                },
              },
            ],
          },
        ],
      },
    };

    // Print the components object before sending the request
    //console.log("Template Components:", JSON.stringify(data.template.components, null, 2));
    //console.log(phone_number_id, data);

    // Send the request using your WhatsApp.Send function
    await WhatsApp.Send(phone_number_id, data);
  }*/
}

class ChatGPT {
  static GetCurrentDateTime() {
    let rtn = "";
    let now = new Date();
    let day = now.toLocaleString("es-ES", { weekday: "long" });
    let date = now.getDate();
    let month = now.toLocaleString("es-ES", { month: "long" });
    let year = now.getFullYear();
    let hours = now.getHours();
    let minutes = now.getMinutes();
    rtn = `Hoy es ${day} ${date} de ${month} de ${year}, son las ${hours}:${
      minutes < 10 ? "0" + minutes : minutes
    }.`;
    //console.log("rtn:", rtn);
    return rtn;
  }

  static async SendToGPT(txt, identity = true, role = "user") {
    let rtn = "";
    for (let i = 1; i <= 3; ++i) {
      try {
        let messages = [];
        let fecha = ChatGPT.GetCurrentDateTime();
        //console.log("fechaGPT:",fecha);
        if (identity) {
          messages.push({ role: "system", content: IDENTITY_CONTEXT });
        }
        messages.push({ role: "system", content: `Fecha actual: ${fecha}` });
        messages.push({ role: role, content: txt });
        // gpt-4-turbo-preview
        // gpt-4-turbo
        // gpt-4o
        // gpt-4o-mini
        // gpt-3.5-turbo
        // o1-mini
        let response = await axios.post(
          OPENAI_API_URL,
          {
            model: "gpt-4-turbo-preview",
            messages: messages,
            max_tokens: 400,
            temperature: 0,
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );
        rtn = response?.data?.choices?.[0]?.message?.content?.trim() ?? "";
        if (rtn != "") {
          break;
        }
      } catch (ex) {
        DoLog(
          `Error al enviar datos a GPT-4 Turbo intento ${i}: ${ex}`,
          Log.Error
        );
      }
      sleep(100);
    }
    return rtn;
  }

  static async IdComida(txt) {
    let rtn = "";

    try {
      let msg = ` ${txt} Un peluquero ha proporcionado su id y la hora a la que quiere solicitar su comida. No utlices para la respuesta ningun comando, solo devuelve el id y la fecha y hora solicitada en formato ISO 8601 con zona horaria de Madrid (Europa). el formato de tu respuesta solo deberia ser asi, sin la palabra 'HORACOMIDA': "id fechayhora"`;
      let response = await ChatGPT.SendToGPT(msg, true, "assistant");
      rtn = response?.data?.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (ex) {
      throw ex;
    }
    return rtn;
  }

  static async CalculaServicioID(servicio) {
    let rtn = "";
    try {
      let msg = ` ${serviciosList} Un cliente me ha dicho que quiere este servicio: ${servicio}. Solo escribe el id al que corresponde el servicio al que se refiere mi cliente. Si no eres capaz de hacer esto, contesta sólamente con el carácter X.`;
      rtn = await ChatGPT.SendToGPT(msg);
      if (rtn == "X") {
        rtn = "";
      }
    } catch (ex) {
      throw ex;
    }
    return rtn;
  }

  static async CalculaCentroID(salon) {
    let rtn = "";
    try {
      //console.log(salonesList);
      let msg = ` ${salonesList} Un cliente me ha dicho que quiere este salon: ${salon}. Solo escribe el id al que corresponde el salon al que se refiere mi cliente. Si no eres capaz de hacer esto, contesta sólamente con el carácter X.`;
      rtn = await ChatGPT.SendToGPT(msg);
      if (rtn == "X") {
        rtn = "";
      }
    } catch (ex) {
      throw ex;
    }
    return rtn;
  }

  static async CalculaServicio(servicio) {
    let rtn = "";
    try {
      let msg = ` ${serviciosList} Un cliente me ha dicho que quiere este servicio: ${servicio}. Calculame la duración del servicio o servicios al que corresponde. No utlices para la respuesta ningun comando, devuelvemelo asi "nombre del servicio o los servicios: duracion total (solo el numero)". Si no eres capaz de hacer esto, contesta sólamente con el carácter X.`;
      rtn = await ChatGPT.SendToGPT(msg);
      if (rtn == "X") {
        rtn = "";
      }
    } catch (ex) {
      throw ex;
    }
    return rtn;
  }

  static async GetTime(fecha) {
    let rtn = "";
    try {
      let msg = `Esta es la fecha y hora que el cliente ha solicitado: ${fecha}. Solo devuelve la fecha y hora en formato ISO 8601 con zona horario de Madrid (Europa) y nada mas. Si no eres capaz de hacer esto, contesta sólamente con el carácter X.`;
      rtn = await ChatGPT.SendToGPT(msg);
      if (rtn == "X") {
        rtn = "";
      }
    } catch (ex) {
      throw ex;
    }
    return rtn;
  }

  static async CalculaPeluquero(peluquero, salonID) {
    let rtn = "";
    try {
      // Filtrar la lista de peluqueros solo para el centro especificado
      const peluquerosDelCentro = peluqueros
        .filter((peluquero) => peluquero.salonID === salonID)
        .map((p) => `${p.peluqueroID}: ${p.name}`)
        .join(", ");

      //console.log("peluquerosDelCentro:", peluquerosDelCentro);

      // Crear el mensaje solo con los peluqueros del centro
      let msg = ` ${peluquerosDelCentro} Un cliente me ha dicho que quiere en este peluquero: ${peluquero}. Solo escribe el id al que corresponde el peluquero al que se refiere mi cliente. Si puede ser más de un peluquero escribe "MOREINFO". Si no eres capaz de hacer esto, contesta sólamente con el carácter X.`;
      rtn = await ChatGPT.SendToGPT(msg);

      if (rtn == "X") {
        rtn = "";
      }
    } catch (ex) {
      throw ex;
    }
    return rtn;
  }
}

class StatisticsManager {
  constructor() {
    this.statsModel = Statistics; // Modelo de MongoDB para estadísticas diarias
  }

  // Guardar estadísticas diarias
  async saveDailyStats(stats) {
    const dailyStats = new this.statsModel({
      date: new Date(),
      confirmedAppointments: stats.confirmedAppointments,
      canceledAppointments: stats.canceledAppointments,
      failedOperations: stats.failedOperations,
      interactions: stats.interactions,
      feedbackResponses: stats.feedbackResponses,
    });
    await dailyStats.save();
  }

  // Obtener estadísticas del día actual
  async getTodayStatistics() {
    const today = moment().startOf("day").toDate();
    return await this.statsModel.findOne({ date: { $gte: today } });
  }

  // Incrementar citas confirmadas
  async incrementConfirmedAppointments() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { confirmedAppointments: 1 } },
      { upsert: true }
    );
  }

  // Método para incrementar el número de citas modificadas
  async incrementModifiedAppointments() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { modifiedAppointments: 1 } },
      { upsert: true }
    );
  }

  // Incrementar citas canceladas
  async incrementCanceledAppointments() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { canceledAppointments: 1 } },
      { upsert: true }
    );
  }

  // Incrementar operaciones fallidas
  async incrementFailedOperations() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { failedOperations: 1 } },
      { upsert: true }
    );
  }

  // Incrementar interacciones
  async incrementInteractions() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { interactions: 1 } },
      { upsert: true }
    );
  }

  // Incrementar respuestas de feedback
  async incrementFeedbackResponses() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { feedbackResponses: 1 } },
      { upsert: true }
    );
  }

  // Incrementar el contador de escaneos de QR
  async incrementQRScans() {
    const today = moment().startOf("day").toDate();
    await this.statsModel.findOneAndUpdate(
      { date: { $gte: today } },
      { $inc: { qrScans: 1 } },
      { upsert: true }
    );
  }

  // Obtener estadísticas del mes anterior
  async getMonthlyStatistics() {
    const startOfMonth = moment()
      .subtract(1, "month")
      .startOf("month")
      .toDate();
    const endOfMonth = moment().subtract(1, "month").endOf("month").toDate();

    const monthlyStats = await this.statsModel.aggregate([
      { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
      {
        $group: {
          _id: null,
          confirmedAppointments: { $sum: "$confirmedAppointments" },
          modifiedAppointments: { $sum: "$modifiedAppointments" },
          canceledAppointments: { $sum: "$canceledAppointments" },
          failedOperations: { $sum: "$failedOperations" },
          interactions: { $sum: "$interactions" },
          feedbackResponses: { $sum: "$feedbackResponses" },
        },
      },
    ]);

    return monthlyStats[0];
  }
}

// Inicializa el gestor de estadísticas
const statisticsManager = new StatisticsManager();

class CommandQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  addCommand(command) {
    this.queue.push(command);
  }

  async processNextCommand(conversation) {
    if (this.queue.length === 0 || this.processing) {
      return "";
    }

    this.processing = true;
    const command = this.queue.shift();
    console.log("command:", command);
    let rtn = "";
    
    try {
      let gpt = new Message(WhoEnum.ChatGPT);
      gpt.message = command;
      rtn = await conversation.ProcessOne(gpt);
      console.log("rtn:", rtn);
      if (rtn !== "") {
        await WhatsApp.Responder(_phone_number_id, conversation.from, rtn);
        conversation.CancelWatchDog();
      }
    } catch (error) {
      DoLog(`Error procesando comando: ${error}`, Log.Error);
    }

    this.processing = false;

    // Si hay más comandos en la cola, procesar el siguiente
    if (this.queue.length > 0) {
      return await this.processNextCommand(conversation);
    }
    
    // Si no hay más comandos, solicitar una nueva respuesta a ChatGPT
    if (this.queue.length === 0) {
      conversation.GetFull();
      let msg = `${conversation.full}.\n Teniendo toda esta conversación, ¿qué le dirías al cliente? SOLO escribe el mensaje que debería llegarle al cliente.`;
      let response = await ChatGPT.SendToGPT(msg);
      console.log("response:", response);
      let responseMsg = new Message(WhoEnum.ChatGPT);
      responseMsg.message = response;
      conversation.AddMsg(responseMsg);
      
      return response;
    }
    
    return rtn;
  }
}
