import { Anthropic } from "@anthropic-ai/sdk"
import { execSync } from "child_process"

interface GitHubIssueOptions {
  owner: string
  repo: string
  title: string
  body: string
  labels?: string[]
}

const SYSTEM_PROMPT = {
  type: "text",
  text: `You are a helpful assistant that generates clear and concise pull request messages. Use markdown.`,
  cache_control: { type: "ephemeral" }
} as const

interface PullRequestOptions {
  owner: string
  repo: string
  head: string
  base: string
}

/**
 * Gets the current branch name using git command or environment variables
 */
function getCurrentBranch(): string {
  // Check if we're in Vercel environment
  if (process.env.VERCEL) {
    // Use Vercel's environment variable for branch name
    const vercelBranch = process.env.VERCEL_GIT_COMMIT_REF;
    if (!vercelBranch) {
      throw new Error('Unable to determine branch name in Vercel environment');
    }
    return vercelBranch;
  }

  // If not in Vercel, use git command
  try {
    return execSync("git rev-parse --abbrev-ref HEAD").toString().trim();
  } catch (error) {
    console.error('Failed to get branch name using git command:', error);
    throw new Error('Unable to determine branch name');
  }
}

/**
 * Generates a PR message using Claude based on git diff
 */
async function generatePRMessage(): Promise<{ title: string; body: string }> {
  console.log("Starting PR message generation...")
  
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set")
  }

  const anthropicClient = new Anthropic({
    apiKey
  })

  // Get git diff between current branch and main
  console.log("Fetching git diff...")
  const diff = execSync("git diff origin/main").toString()
  console.log("Git diff length:", diff.length, "characters")
  
  console.log("Sending diff to Claude for PR message generation...")
  const message = await anthropicClient.beta.promptCaching.messages.create({
    model: "claude-3-5-sonnet-latest",
    max_tokens: 1000,
    temperature: 0,
    system: [SYSTEM_PROMPT],
    messages: [{
      role: "user", 
      content: [{
        type: "text",
        text: `Generate a pull request message for the following changes between main and feature branches:\n\n${diff}`
      }]
    }]
  })

  console.log("Received response from Claude")
  const responseText = message.content[0].type === "text" ? message.content[0].text : ""
  const [title, ...bodyParts] = responseText.split("\n\n")

  console.log("Generated PR title:", title.trim())
  console.log("Generated PR body length:", bodyParts.join("\n\n").trim().length, "characters")

  return {
    title: title.trim(),
    body: bodyParts.join("\n\n").trim()
  }
}

/**
 * Creates a pull request on GitHub using the GitHub API from the current branch to main
 */
async function createPR(options: PullRequestOptions, message: { title: string; body: string }) {
  console.log("Creating PR with options:", options)
  const currentBranch = getCurrentBranch()
  const token = currentBranch === "raffi" ? process.env.RAFFI_PAT_TOKEN : process.env.PAT_TOKEN
  
  console.log("Sending PR creation request to GitHub...")
  const response = await fetch(`https://api.github.com/repos/${options.owner}/${options.repo}/pulls`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: message.title,
      body: message.body,
      head: options.head,
      base: options.base
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("GitHub API error response:", errorText)
    throw new Error(`Failed to create PR: ${errorText}`)
  }

  const prData = await response.json()
  console.log("Successfully created PR #" + prData.number)
  const prUrl = `https://github.com/${options.owner}/${options.repo}/pull/${prData.number}`
  
  if (process.stdout.isTTY) {
    // Terminal environment - use clickable link
    console.log(`\u001B]8;;${prUrl}\u0007🔗 PR URL: ${prUrl}\u001B]8;;\u0007`)
  } else {
    // Non-terminal environment - fallback to plain text
    console.log(`🔗 PR URL: ${prUrl}`)
  }
  return prData
}

/**
 * Syncs the current branch with main by fetching and rebasing
 */
export async function syncWithMain(): Promise<void> {
  console.log("Syncing with main...")
  const currentBranch = getCurrentBranch()
  
  // First push current branch changes to origin
  console.log(`Pushing current changes to origin/${currentBranch}...`)
  try {
    execSync(`git push origin ${currentBranch}`)
  } catch (error) {
    console.error("❌ Failed to push current changes.")
    throw new Error(`Please ensure your changes are committed and try again: ${error}`)
  }

  // Fetch latest changes from origin
  console.log("Fetching latest changes from origin...")
  execSync("git fetch origin")
  
  try {
    // Rebase directly against origin/main while staying on current branch
    console.log("Rebasing current branch onto origin/main...")
    execSync("git rebase origin/main")
    
    // Force push with lease after successful rebase
    console.log("Pushing rebased changes...")
    execSync("git push --force-with-lease")
  } catch (error) {
    console.error("❌ Rebase failed. You may have conflicts to resolve.")
    execSync("git rebase --abort")
    throw new Error("Please manually rebase your branch on main and resolve conflicts before creating PR")
  }
}

/**
 * Creates a pull request from current branch to main with an AI-generated message
 */
export async function createPRToMain(): Promise<void> {
  try {
    console.log("Starting PR creation process...")
    
    // Check if there are changes to commit
    const status = execSync('git status --porcelain').toString()
    if (status) {
      console.log('Changes detected, committing...')
      execSync('git add .')
      execSync('git commit -m "sync"')
      execSync('git push --force-with-lease')
    }
    
    const currentBranch = getCurrentBranch()
    console.log(`Current branch: ${currentBranch}`)
    
    // Sync with main
    await syncWithMain()
    
    // Generate PR message
    console.log("Generating PR message...")
    const prMessage = await generatePRMessage()
    
    // Create the PR
    console.log("Creating PR on GitHub...")
    await createPR({
      owner: "modern-realty-inc",
      repo: "plug-chat",
      head: currentBranch,
      base: "main"
    }, prMessage)

    console.log(`✅ Successfully created PR from ${currentBranch} to main`)
  } catch (error) {
    console.error("❌ Failed to create PR:", error)
    throw error
  }
}

/**
 * Creates a GitHub issue using the GitHub API
 */
export async function createGitHubIssue(options: GitHubIssueOptions): Promise<void> {
  console.log("Creating GitHub issue with options:", options)
  const currentBranch = getCurrentBranch()
  const token = currentBranch === "raffi" ? process.env.RAFFI_PAT_TOKEN : process.env.PAT_TOKEN
  
  console.log("Sending issue creation request to GitHub...")
  const response = await fetch(`https://api.github.com/repos/${options.owner}/${options.repo}/issues`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": `token ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: options.title,
      body: options.body,
      labels: options.labels || []
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error("GitHub API error response:", errorText)
    throw new Error(`Failed to create issue: ${errorText}`)
  }

  const issueData = await response.json()
  console.log("Successfully created issue #" + issueData.number)
  const issueUrl = `https://github.com/${options.owner}/${options.repo}/issues/${issueData.number}`
  
  if (process.stdout.isTTY) {
    // Terminal environment - use clickable link
    console.log(`\u001B]8;;${issueUrl}\u0007🔗 Issue URL: ${issueUrl}\u001B]8;;\u0007`)
  } else {
    // Non-terminal environment - fallback to plain text
    console.log(`🔗 Issue URL: ${issueUrl}`)
  }
}

// Handle direct script execution
if (process.argv.includes('--sync')) {
  syncWithMain()
    .then(() => console.log('✅ Successfully synced with main'))
    .catch(error => {
      console.error('❌ Sync failed:', error)
      process.exit(1)
    })
}
