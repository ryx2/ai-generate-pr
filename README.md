# AI-Powered GitHub Automation Toolkit

A TypeScript utility for AI-assisted GitHub workflow automation featuring intelligent PR message generation and branch management.

## Features

- 🤖 **AI-generated pull request messages** using Claude-3.5-Sonnet
- 🔄 **Automatic branch synchronization** with main/master
- 🚀 **GitHub API integration** for PR/issue management
- 📝 **Git diff analysis** for contextual AI responses
- 🔒 **Secure token management** with environment variables
- 🖥️ **Terminal-friendly output** with clickable PR/issue links

## Usage

### Basic PR Creation

```typescript
import { createPRToMain } from './lib/services/git/createPullRequest'
// Creates PR from current branch to main with AI-generated message
await createPRToMain();
```

### GitHub Issue Creation

```typescript
import { createGitHubIssue } from './lib/services/git/createPullRequest'
await createGitHubIssue({
owner: "your-org",
repo: "your-repo",
title: "Bug Report",
body: "Detailed issue description",
labels: ["bug"]
});
```
