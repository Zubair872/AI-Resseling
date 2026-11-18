// Purpose: email boundary. MAIL_PROVIDER=resend sends through Resend's HTTP API (needs RESEND_API_KEY and a verified sender domain).
// Without a provider nothing is delivered and the result says so (delivered:false). Delivery is only reported true when Resend returns an id.
import { config } from './config.js'
import { ResendMailer, type Mail, type Mailer } from './resend.js'

export type { Mail, Mailer }

export const testOutbox: Mail[] = []

class UndeliveredMailer implements Mailer {
  async send(mail: Mail) {
    if (config.NODE_ENV === 'test') testOutbox.push(mail)
    else if (config.NODE_ENV === 'production') console.warn(JSON.stringify({ event: 'mail.not_delivered', reason: 'no email provider configured', subject: mail.subject }))
    else console.info(`[mail not delivered - no provider configured] to=${mail.to} subject=${mail.subject}\n${mail.text}`)
    return { delivered: false }
  }
}

export const mailer: Mailer = config.MAIL_PROVIDER === 'resend' && config.RESEND_API_KEY ? new ResendMailer(config.RESEND_API_KEY, config.MAIL_FROM) : new UndeliveredMailer()
