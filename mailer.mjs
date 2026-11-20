// Avisos por correo de cada reserva: uno al taller y una confirmación al cliente.
// Se activa definiendo SMTP_HOST, SMTP_USER y SMTP_PASS en .env; sin ellos no se envía nada.

const SPECIES_LABELS = { perro: 'Perro', gato: 'Gato', otro: 'Otro animal' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatPrice(value) {
  return '$' + Number(value).toLocaleString('es-CL');
}

export function mailConfig(env = process.env) {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  if (!host || !user || !pass) return null;
  const port = Number(env.SMTP_PORT) || 465;
  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    from: env.MAIL_FROM?.trim() || user,
    notifyTo: env.NOTIFY_TO?.trim() || user
  };
}

function layout(title, rows, closing) {
  const cells = rows.map(([label, value]) => '<tr><td style="padding:6px 16px 6px 0;color:#71776e;font-size:13px;vertical-align:top">' + escapeHtml(label)
    + '</td><td style="padding:6px 0;font-size:14px">' + escapeHtml(value) + '</td></tr>').join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;color:#242922;max-width:520px">'
    + '<h2 style="font-size:20px;margin:0 0 14px">' + escapeHtml(title) + '</h2>'
    + '<table style="border-collapse:collapse">' + cells + '</table>'
    + '<p style="font-size:14px;line-height:1.6;margin:18px 0 0">' + escapeHtml(closing) + '</p></div>';
}
function plain(title, rows, closing) {
  return title + '\n\n' + rows.map(([label, value]) => label + ': ' + value).join('\n') + '\n\n' + closing + '\n';
}

// Devuelve los dos mensajes listos para enviar: [aviso al taller, confirmación al cliente].
export function buildOrderEmails(order, config) {
  const from = { name: 'FORMA', address: config.from };
  const pet = order.petName || 'Sin nombre';
  const finish = order.finish === 'pintada' ? 'pintada por el taller' : 'en blanco';
  const quantity = Number(order.quantity) > 1 ? Number(order.quantity) : 1;
  const extras = order.extrasText ? ', ' + order.extrasText : '';
  const figure = order.measure + ', ' + finish + extras + ' · ' + formatPrice(order.price);
  const species = SPECIES_LABELS[order.species] || order.species || '';

  const shopRows = [
    ['Reserva', order.code],
    ['Figura', figure],
    ['Mascota', pet + (species ? ' (' + species + ')' : '')],
    ['Cliente', order.name],
    ['Correo', order.email]
  ];
  if (quantity > 1) shopRows.push(['Cantidad', quantity + ' figuras iguales']);
  if (order.baseName) shopRows.push(['Nombre en la base', order.baseName]);
  if (order.notes) shopRows.push(['Comentarios', order.notes]);
  shopRows.push(['Modelo', order.modelFile ? 'Guardado como ' + order.modelFile : 'No se pudo guardar una copia']);
  const shopTitle = 'Nueva reserva ' + order.code;
  const shopClosing = 'Responde este correo para escribirle directamente al cliente. El detalle y el modelo están en el panel de reservas.';

  const customerRows = [
    ['Código de reserva', order.code],
    ['Figura', (order.petName ? 'La figura de ' + order.petName : 'Tu figura') + ', ' + order.measure + ', ' + finish + extras],
    ...(quantity > 1 ? [['Cantidad', quantity + ' figuras iguales']] : []),
    ['Precio', formatPrice(order.price) + ' (el envío se cotiza según tu comuna)']
  ];
  const customerTitle = 'Hola ' + order.name + ', recibimos tu reserva';
  const customerClosing = 'Pronto te escribiremos para confirmar el pago y el envío. Puedes ver en qué etapa va tu figura en la sección "Mi pedido" del sitio, con este código y tu correo. Si tienes alguna duda, responde este correo.';

  return [
    {
      from,
      to: config.notifyTo,
      replyTo: { name: order.name, address: order.email },
      subject: shopTitle + ' · ' + order.measure + (order.finish === 'pintada' ? ' pintada' : '') + ' · ' + pet,
      text: plain(shopTitle, shopRows, shopClosing),
      html: layout(shopTitle, shopRows, shopClosing)
    },
    {
      from,
      to: { name: order.name, address: order.email },
      replyTo: config.notifyTo,
      subject: 'Recibimos tu reserva ' + order.code + ' · FORMA',
      text: plain(customerTitle, customerRows, customerClosing),
      html: layout(customerTitle, customerRows, customerClosing)
    }
  ];
}

// Nunca lanza: una falla de correo no debe afectar a la reserva, que ya quedó guardada.
export async function sendOrderEmails(order) {
  const config = mailConfig();
  if (!config) return { configured: false, shop: false, customer: false };
  try {
    const { default: nodemailer } = await import('nodemailer');
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass }
    });
    const [shop, customer] = await Promise.allSettled(buildOrderEmails(order, config).map((message) => transport.sendMail(message)));
    const error = [shop, customer].find((result) => result.status === 'rejected')?.reason?.message;
    return { configured: true, shop: shop.status === 'fulfilled', customer: customer.status === 'fulfilled', error };
  } catch (error) {
    return { configured: true, shop: false, customer: false, error: error.message };
  }
}
