import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST || "smtp.gmail.com";
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER || "naoresponda.logisticasbill@gmail.com";
const pass = process.env.SMTP_PASS || "";
const from = process.env.SMTP_FROM || `"Logísticas Bill" <${user}>`;

function getTransport() {
  if (!pass) {
    throw new Error("SMTP_PASS não configurado. Defina a senha de app do Gmail no ambiente.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  username: string;
  resetUrl: string;
}) {
  const transport = getTransport();

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px">Redefinição de senha</h2>
      <p>Olá, <strong>${opts.name}</strong>.</p>
      <p>Recebemos uma solicitação para redefinir a senha do usuário <strong>${opts.username}</strong> no sistema Logísticas Bill.</p>
      <p>O link abaixo é válido por <strong>30 minutos</strong>:</p>
      <p style="margin:24px 0">
        <a href="${opts.resetUrl}" style="background:#0f172a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
          Redefinir senha
        </a>
      </p>
      <p style="font-size:13px;color:#555">Se você não solicitou esta alteração, ignore este e-mail. Nenhuma alteração será feita.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="font-size:12px;color:#888">Logísticas Bill · naoresponda.logisticasbill@gmail.com</p>
    </div>
  `;

  await transport.sendMail({
    from,
    to: opts.to,
    subject: "Logísticas Bill — redefinição de senha",
    html,
    text: `Olá ${opts.name},

Use este link para redefinir a senha do usuário ${opts.username} (válido por 30 minutos):
${opts.resetUrl}

Se não foi você, ignore este e-mail.`,
  });
}