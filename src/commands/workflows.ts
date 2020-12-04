import { Command, flags } from '@oclif/command'
import * as fs from 'fs'
import { handle } from 'oazapfts'
import * as api from '../api'
import { assertNever } from '../utils/assertNever'
import setupApiClient from '../setupApiClient'
import withStandardErrors from '../utils/errorHandling'

enum Subcommand {
  list = 'list',
  add = 'add',
  delete = 'delete',
}

const workflowTypeFlags = [
  'send',
  'alias',
  'forward',
  'reply',
  'replyall',
  'webhook',
]

export default class Workflows extends Command {
  static description = 'manipulate workflows'

  static flags = {
    help: flags.help({ char: 'h' }),
    workflow: flags.string({
      description: 'id of the workflow to be acted on',
    }),
    name: flags.string({
      char: 't',
      description: 'name of the workflow',
    }),
    trigger: flags.string({
      char: 't',
      description: 'id of the trigger accessory',
    }),
    action: flags.string({
      char: 'a',
      description: 'id of the action accessory',
    }),
    forward: flags.string({
      char: 'f',
      description: 'email address for forward action',
    }),
    reply: flags.boolean({
      char: 'r',
      description: 'email address for reply action',
    }),
    replyall: flags.boolean({
      description: 'email address for reply all action',
    }),
    send: flags.string({
      description: 'email address for send action',
    }),
    alias: flags.string({
      description: 'email address for alias action',
    }),
    subject: flags.string({
      char: 's',
      description: 'subject of the email',
    }),
    text: flags.string({
      char: 't',
      description: 'text of the email',
    }),
    html: flags.string({
      char: 'h',
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
    times: flags.string({
      description: 'number of emails in a period for trigger to activate',
    }),
    seconds: flags.string({
      description: 'period of time to calculate the trigger over',
    }),
    from: flags.string({
      description: 'constrain trigger to emails from the specified address',
    }),
    sentto: flags.string({
      description: 'constrain trigger to emails sent to the specified address',
    }),
    subjectcontains: flags.string({
      description:
        'constrain trigger to emails whose subject contains the specified text',
    }),
    domain: flags.string({
      description:
        'constrain trigger to emails are from an email address with the given domain',
    }),
    hasthewords: flags.string({
      description: 'constrain trigger to emails that have the words specified',
    }),
    hasattachments: flags.boolean({
      description: 'constrain trigger to emails with attachments',
    }),
  }

  static args = [
    {
      name: 'subcommand',
      required: true,
      default: Subcommand.list,
      options: Object.keys(Subcommand),
      parse: (input: string) => Subcommand[input as keyof typeof Subcommand],
    },
  ]

  async run() {
    const { args, flags } = this.parse(Workflows)

    const subcommand: Subcommand = args.subcommand

    const client = await setupApiClient()

    switch (subcommand) {
      case Subcommand.list:
        return this.list(client)
      case Subcommand.add:
        return this.add(client, flags)
      case Subcommand.delete:
        return this.delete(client, flags)
      default:
        assertNever(subcommand)
    }
  }

  async list(client: typeof api): Promise<void> {
    return handle(
      client.getAllWorkflows(),
      withStandardErrors(
        {
          '200': ({ list }: api.GetAllWorkflowsResponse) => {
            if (!list || list.length === 0) {
              this.log(
                `you don't have an workflow currently, create one with: mailscript workflows add`,
              )
              this.exit(0)
            }

            this.log('workflows')
            for (const workflow of list || []) {
              this.log(`  ${workflow.id}`)
            }
          },
        },
        this,
      ),
    )
  }

  async add(client: typeof api, flags: any): Promise<void> {
    if (!flags.name) {
      this.log(
        'Please provide a name: mailscript workflows add --name <personal-forward>',
      )
      this.exit(1)
    }

    if (!flags.trigger) {
      this.log(
        'Please provide a trigger: mailscript workflows add --trigger <accessory-id>',
      )
      this.exit(1)
    }

    const accessories = await this._getAllAccessories()

    const triggerAccessory = this._findAccessoryBy(accessories, flags.trigger)
    const actionAccessory = this._resolveActionAccessory(flags, accessories)

    if (
      actionAccessory.type !== 'sms' &&
      workflowTypeFlags.map((atf) => flags[atf]).filter((f) => Boolean(f))
        .length !== 1
    ) {
      this.log(
        'Please provide one type flag either: \n  --' +
          workflowTypeFlags.join('\n  --'),
      )
      this.exit(1)
    }

    const triggerConfig = this._resolveTriggerConfig(flags, triggerAccessory)

    const actionConfig = this._resolveActionConfig(flags, actionAccessory)

    const payload: api.AddWorkflowRequest = {
      name: flags.name,
      trigger: {
        accessoryId: triggerAccessory.id,
        config: triggerConfig,
      },
      actions: [
        {
          accessoryId: actionAccessory.id,
          config: actionConfig,
        },
      ],
    }

    return handle(
      client.addWorkflow(payload),
      withStandardErrors(
        {
          '201': (response: any) => {
            this.log(`Workflow setup: ${response.id}`)
          },
        },
        this,
      ),
    )
  }

  async delete(client: typeof api, flags: any): Promise<void> {
    if (!flags.workflow) {
      this.log(
        'Please provide the workflow id: mailscript workflows delete --workflow <workflow-id>',
      )
      this.exit(1)
    }

    return handle(
      client.deleteWorkflow(flags.workflow),
      withStandardErrors(
        {
          '204': (_response: any) => {
            this.log(`Workflow deleted: ${flags.workflow}`)
          },
        },
        this,
      ),
    )
  }

  private _resolveTriggerConfig(flags: any, triggerAccessory: api.Accessory) {
    if (flags.times && !flags.seconds) {
      this.log('Flag --seconds required when using --times')
      this.exit(1)
    }

    if (!flags.times && flags.seconds) {
      this.log('Flag --times required when using --seconds')
      this.exit(1)
    }

    let criterias: Array<any> = []
    if (
      flags.from ||
      flags.sentto ||
      flags.hasthewords ||
      flags.domain ||
      flags.subjectcontains ||
      flags.hasattachments
    ) {
      criterias = [
        {
          from: flags.from,
          sentTo: flags.sentto,
          hasTheWords: flags.hasthewords,
          domain: flags.domain,
          subjectContains: flags.subjectcontains,
          hasAttachments: flags.hasattachments,
        },
      ]
    } else if (triggerAccessory.type === 'mailscript-email') {
      criterias = [
        {
          sentTo: triggerAccessory.address,
        },
      ]
    }

    return flags.times && flags.seconds
      ? {
          times: {
            thisManyTimes: parseInt(flags.times, 10),
            thisManySeconds: parseInt(flags.seconds, 10),
          },
          criterias,
        }
      : {
          criterias,
        }
  }

  private _resolveActionConfig(flags: any, actionAccessory: api.Accessory) {
    if (actionAccessory && actionAccessory.type === 'sms') {
      if (!flags.text) {
        this.log('Please provide --text')
        this.exit(1)
      }

      return {
        type: 'sms',
        text: flags.text,
      }
    }

    if (flags.forward) {
      return {
        type: 'forward',
        forward: flags.forward,
      }
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

      return {
        type: 'send',
        to: flags.send,
        subject: flags.subject,
        text: flags.text,
        html: flags.html,
      }
    }

    if (flags.reply) {
      if (!flags.text && !flags.html) {
        this.log('Please provide either --text or --html')
        this.exit(1)
      }

      return {
        type: 'reply',
        text: flags.text,
        html: flags.html,
      }
    }

    if (flags.replyall) {
      if (!flags.text && !flags.html) {
        this.log('Please provide either --text or --html')
        this.exit(1)
      }

      return {
        type: 'replyAll',
        text: flags.text,
        html: flags.html,
      }
    }

    if (flags.alias) {
      return {
        type: 'alias',
        alias: flags.alias,
      }
    }

    if (flags.webhook) {
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
        type: 'webhook',
        url: flags.webhook,
        opts: {
          headers: headers,
          method,
        },
        body,
      }
    }

    return {}
  }

  private _resolveActionAccessory(
    flags: any,
    accessories: Array<api.Accessory>,
  ) {
    if (flags.webhook) {
      return this._findAccessoryBy(accessories, 'webhook')
    }

    if (flags.action) {
      return this._findAccessoryBy(accessories, flags.action)
    }

    return this._findAccessoryBy(accessories, flags.trigger)
  }

  private async _getAllAccessories(): Promise<Array<api.Accessory>> {
    const response = await api.getAllAccessories()

    if (response.status !== 200) {
      this.log(`Error: unable to read accessories - ${response.data.error}`)
      this.exit(1)
    }

    return response.data.list || []
  }

  private _findAccessoryBy(
    accessories: Array<api.Accessory>,
    nameOrId: string,
  ): api.Accessory {
    const accessory = accessories.find(
      (a) => a.id === nameOrId || a.name === nameOrId,
    )

    if (!accessory) {
      this.log(`Error: not an available accessory: ${nameOrId}`)
      this.exit(1)
    }

    return accessory
  }
}