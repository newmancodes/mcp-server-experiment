import "dotenv/config";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { confirm, input, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Prompt, PromptMessage, Tool } from "@modelcontextprotocol/sdk/types.js";
import { generateText } from "ai";

const mcp = new Client({
    name: "Test Client",
    version: "1.0.0"
    },
    {
        capabilities: { sampling: {} }
    }
)

const transport = new StdioClientTransport({
    command: "node",
    args: [ "build/server.js" ],
    stderr: "ignore"
})

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY
})

async function main() {
    await mcp.connect(transport)
    const [{ tools }, { prompts }, { resources }, {resourceTemplates }] = await Promise.all([
        mcp.listTools(),
        mcp.listPrompts(),
        mcp.listResources(),
        mcp.listResourceTemplates()
    ])

    console.log("You are connected!")
    while (true) {
        const option = await select( {
            message: "What would you like to do?",
            choices: [ "Query", "Tools", "Resources", "Prompts" ]
        })

        switch (option) {
            case "Prompts": {
                const promptName = await select({
                    message: "Select a prompt to use",
                    choices: prompts.map(prompt => ({
                        name: prompt.name,
                        value: prompt.name,
                        description: prompt.description,
                    })),
                })
                const prompt = prompts.find(p => p.name === promptName);
                if (prompt == null) {
                    console.error("Prompt not found");
                } else {
                    const result = await handlePrompt(prompt);
                }
                break
            }
            case "Resources": {
                const resourceUri = await select({
                    message: "Select a resource to view",
                    choices: [
                        ...resources.map(resource => ({
                            name: resource.name,
                            value: resource.uri,
                            description: resource.description,
                        })),
                        ...resourceTemplates.map(template => ({
                            name: template.name,
                            value: template.uriTemplate,
                            description: template.description,
                        }))
                    ],
                })
                const uri =
                    resources.find(r => r.uri === resourceUri)?.uri ??
                    resourceTemplates.find(t => t.uriTemplate === resourceUri)?.uriTemplate
                if (uri == null) {
                    console.error("Resource not found");
                } else {
                    await handleResource(uri);
                }
                break
            }
            case "Tools": {
                const toolName = await select({
                    message: "Select a tool to use",
                    choices: tools.map(tool => ({
                        name: tool.annotations?.title || tool.name,
                        value: tool.name,
                        description: tool.description,
                    })),
                })
                const tool = tools.find(t => t.name === toolName);
                if (tool == null) {
                    console.error("Tool not found");
                } else {
                    await handleTool(tool);
                }
                break
            }
        }
    }
}

async function handlePrompt(prompt: Prompt): Promise<void> {
    const args: Record<string, string>  = {}
    for (const arg of prompt.arguments ?? []) {
        args[arg.name] = await input({
            message: `Enter value for ${arg.name}:`,
        })
    }

    const response = await mcp.getPrompt({
        name: prompt.name,
        arguments: args
    })

    for (const message of response.messages) {
        console.log(await handleServerMessagePrompt(message))
    }
}

async function handleServerMessagePrompt(message: PromptMessage): Promise<string> {
    if (message.content.type !== "text")
        return "Unsupported message type";

    console.log(message.content.text);
    const run = await confirm({
        message: "Would you like to run this prompt?",
        default: true
    })

    if (!run) {
        return "Prompt not run";
    }

    const { text } = await generateText({
        model: google("gemini-2.0-flash"),
        prompt: message.content.text,
    })

    return text
}

async function handleResource(uri: string): Promise<void> {
    let finalUri = uri
    const paramMatches = uri.match(/{([^}]+)}/g)

    if (paramMatches != null) {
        for (const paramMatch of paramMatches) {
            const paramName = paramMatch.replace("{", "").replace("}", "")
            const paramValue = await input({
                message: `Enter value for ${paramName}:`
            })
            finalUri = finalUri.replace(paramMatch, encodeURIComponent(paramValue))
        }
    }

    const result = await mcp.readResource({
        uri: finalUri
    })

    console.log(JSON.stringify(JSON.parse(result.contents[0].text as string), null, 2))
}

async function handleTool(tool: Tool): Promise<void> {
    const args: Record<string, string>  = {}
    for (const [key, value] of Object.entries(tool.inputSchema.properties ?? {})) {
        args[key] = await input({
            message: `Enter value for ${key} (${(value as { type: string }).type})`,
        })
    }

    const result = await mcp.callTool({
        name: tool.name,
        arguments: args
    })

    console.log((result.content as [{text: string}])[0].text)
}

main()