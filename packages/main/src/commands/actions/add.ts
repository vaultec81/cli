/* eslint-disable complexity */
import { Command, flags } from '@oclif/command'
import chalk from 'chalk'
import * as fs from 'fs'
import { handle } from 'oazapfts'
import * as api from '../../api'
import setupApiClient from '../../setupApiClient'
import { askVerifyEmailFlow } from '../../utils/askVerifyEmailFlow'
import { askVerifySmsFlow } from '../../utils/askVerifySmsFlow'
import withStandardErrors from '../../utils/errorHandling'

type FlagsType = {
  name: string
  noninteractive: boolean

  forward?: string
  send?: string
  reply?: boolean
  replyall?: boolean
  alias?: string
  webhook?: string

  text?: string
  subject?: string
  html?: string
  method?: string
  body?: string
  headers?: string

  [key: string]: any
}

export default class ActionsAdd extends Command {
  static description = 'add an action'

  static flags = {
    help: flags.help({ char: 'h' }),
    noninteractive: flags.boolean({
      description: 'do not ask for user input',
      default: false,
    }),
    name: flags.string({
      char: 'n',
      description: 'name of the action',
      required: true,
    }),
    sms: flags.string({
      description: 'the sms number to send to',
    }),
    daemon: flags.string({
      description: 'the name of the daemon to send to',
    }),
    forward: flags.string({
      char: 'f',
      description: 'email address for forward action',
    }),
    reply: flags.boolean({
      char: 'r',
      description: 'reply to incoming email',
    }),
    replyall: flags.boolean({
      description: 'reply all to incoming email',
    }),
    send: flags.string({
      description: 'email address for send action',
    }),
    alias: flags.string({
      description: 'email address for alias action',
    }),
    from: flags.string({
      description: 'email address to use as sending from',
    }),
    subject: flags.string({
      char: 's',
      description: 'subject of the email',
    }),
    text: flags.string({
      description: 'text of the email',
    }),
    html: flags.string({
      description: 'html of the email',
    }),
    webhook: flags.string({
      char: 'w',
      description: 'url of the webhook to call',
    }),
    method: flags.enum({
      options: ['PUT', 'POST', 'GET'],
      default: 'POST',
      description: 'HTTP method to use in webhook',
    }),
    headers: flags.string({
      description: 'file to take webhook headers from',
    }),
    body: flags.string({
      description: 'file to take webhook body from',
    }),
  }

  static args = []

  async run() {
    const { flags } = this.parse(ActionsAdd)

    const client = await setupApiClient()

    if (!client) {
      this.exit(1)
    }

    return this.add(client, flags)
  }

  async add(client: typeof api, flags: FlagsType): Promise<void> {
    if (!flags.name) {
      this.log(
        'Please provide a name: mailscript actions:add --name <personal-forward>',
      )

      this.exit(1)
    }

    const payload = this._resolveActionPayload(flags)

    await this._optionallyValidateMailscriptEmail(client, payload)

    if (payload.type === 'sms') {
      await this._optionallyVerifySMS(client, flags, payload.config.number)
    }

    if (
      payload.type === 'mailscript-email' &&
      payload.config.type === 'alias'
    ) {
      await this._optionallyVerifyAlias(client, flags, payload)
    }

    const updatedPayload = await this._enhancePayloadWithFromKeys(
      client,
      payload,
    )

    return handle(
      client.addAction(updatedPayload),
      withStandardErrors(
        {
          '201': () => {
            this.log(`Action setup: ${flags.name}`)
          },
          '403': ({ error }: api.ErrorResponse) => {
            this.log(chalk.red(`${chalk.bold('Error')}: ${error}`))
            this.exit(1)
          },
        },
        this,
      ),
    )
  }

  private _resolveActionPayload(flags: FlagsType) {
    const name = flags.name

    if (flags.sms) {
      if (!flags.text) {
        this.log('Please provide --text')
        this.exit(1)
      }

      return {
        name: name,
        type: 'sms',
        config: {
          number: flags.sms,
          text: flags.text,
        },
      } as api.AddActionSmsRequest
    }

    if (flags.daemon) {
      const body = flags.body
        ? fs.readFileSync(flags.body).toString()
        : undefined

      return {
        name: name,
        type: 'daemon',
        config: {
          daemon: flags.daemon,
          body,
        },
      } as api.AddActionDaemonRequest
    }

    if (flags.webhook) {
      if (!flags.webhook) {
        this.log('Please provide --webhook')
        this.exit(1)
      }

      const method = flags.method ? flags.method : 'POST'

      const body = flags.body ? fs.readFileSync(flags.body).toString() : ''

      const headers = flags.headers
        ? Object.assign(
            {
              'Content-Type': 'application/json',
            },
            JSON.parse(fs.readFileSync(flags.headers).toString()),
          )
        : {
            'Content-Type': 'application/json',
          }

      return {
        name: name,
        type: 'webhook',
        config: {
          url: flags.webhook,
          opts: {
            headers: headers,
            method,
          },
          body,
        },
      } as api.AddActionWebhookRequest
    }

    if (flags.forward) {
      if (!flags.from) {
        this.log('Please provide --from')
        this.exit(1)
      }

      return {
        name: name,
        type: 'mailscript-email',
        config: {
          type: 'forward',
          from: flags.from,
          forward: flags.forward,
        },
      } as api.AddActionForwardRequest
    }

    if (flags.send) {
      if (!flags.subject) {
        this.log('Please provide --subject')
        this.exit(1)
      }

      if (!flags.text && !flags.html) {
        this.log('Please provide either --text or --html')
        this.exit(1)
      }

      if (!flags.from) {
        this.log('Please provide --from')
        this.exit(1)
      }

      return {
        name: name,
        type: 'mailscript-email',
        config: {
          type: 'send',
          to: flags.send,
          subject: flags.subject,
          text: flags.text,
          html: flags.html,
          from: flags.from,
        },
      } as api.AddActionSendRequest
    }

    if (flags.reply) {
      if (!flags.text && !flags.html) {
        this.log('Please provide either --text or --html')
        this.exit(1)
      }

      if (!flags.from) {
        this.log('Please provide --from')
        this.exit(1)
      }

      return {
        name: name,
        type: 'mailscript-email',
        config: {
          type: 'reply',
          text: flags.text,
          html: flags.html,
          from: flags.from,
        },
      } as api.AddActionReplyRequest
    }

    if (flags.replyall) {
      if (!flags.text && !flags.html) {
        this.log('Please provide either --text or --html')
        this.exit(1)
      }

      if (!flags.from) {
        this.log('Please provide --from')
        this.exit(1)
      }

      return {
        name: name,
        type: 'mailscript-email',
        config: {
          type: 'replyAll',
          text: flags.text,
          html: flags.html,
          from: flags.from,
        },
      } as api.AddActionReplyAllRequest
    }

    if (flags.alias) {
      return {
        name: name,
        type: 'mailscript-email',
        config: {
          type: 'alias',
          alias: flags.alias,
        },
      } as api.AddActionAliasRequest
    }

    this.log(`${chalk.bold('Error')}: please provide either:
  --daemon
  --sms
  --webhook
  --send
  --forward
  --reply
  --replyall
  --alias`)

    this.exit(1)
  }

  private async _enhancePayloadWithFromKeys(client: typeof api, payload: any) {
    const {
      type,
      config: { type: mailtype, from },
    } = payload

    if (type !== 'mailscript-email') {
      return payload
    }

    if (
      mailtype === 'forward' ||
      mailtype === 'send' ||
      mailtype === 'reply' ||
      mailtype === 'replyAll'
    ) {
      const { list }: api.GetAllKeysResponse = await handle(
        client.getAllKeys(from),
        withStandardErrors({}, this),
      )

      const key = list.filter((k) => k.write)[0]

      if (!key) {
        this.log('You do not have write permission to that from address')
        this.exit(1)
      }

      return {
        ...payload,
        config: {
          ...payload.config,
          key: key.id,
        },
      }
    }

    return payload
  }

  private async _optionallyValidateMailscriptEmail(
    client: typeof api,
    { type, config: { type: mailtype, from } }: any,
  ) {
    if (type !== 'mailscript-email') {
      return
    }

    if (
      mailtype === 'forward' ||
      mailtype === 'send' ||
      mailtype === 'reply' ||
      mailtype === 'replyAll'
    ) {
      const { list }: api.GetAllAddressesResponse = await handle(
        client.getAllAddresses(),
        withStandardErrors({}, this),
      )

      const match = list.find((address) => address.id === from)
      if (!match) {
        this.log(`Unknown from address ${from}`)
        this.exit(1)
      }
    }
  }

  private async _optionallyVerifySMS(
    client: typeof api,
    flags: FlagsType,
    number: string,
  ) {
    if (!number) {
      throw new Error('SMS must be provided')
    }

    const {
      list: verifications,
    }: api.GetAllVerificationsResponse = await handle(
      client.getAllVerifications(),
      withStandardErrors({}, this),
    )

    const smsVerification = verifications.find(
      (v) => v.type === 'sms' && v.verified && v.sms === number,
    )

    if (smsVerification && smsVerification.verified) {
      return
    }

    await askVerifySmsFlow(
      client,
      number,
      'Action not added',
      flags.noninteractive,
      this,
    )
  }

  private async _optionallyVerifyAlias(
    client: typeof api,
    flags: FlagsType,
    { type, config: { type: mailtype, alias } }: any,
  ) {
    if (type !== 'mailscript-email' || mailtype !== 'alias') {
      return
    }

    if (!alias) {
      throw new Error('Alias must be provided')
    }

    const { email: userEmail } = await handle(
      client.getAuthenticatedUser(),
      withStandardErrors({}, this),
    )

    // User's verified email address
    if (userEmail === alias) {
      return
    }

    const { list: verifications } = await handle(
      client.getAllVerifications(),
      withStandardErrors({}, this),
    )

    const emailVerification = verifications.find(
      (v: api.VerificationEmail) => v.email === alias,
    )

    if (emailVerification && emailVerification.verified) {
      return
    }

    await askVerifyEmailFlow(
      client,
      alias,
      'Action not added',
      flags.noninteractive,
      this,
    )
  }
}
