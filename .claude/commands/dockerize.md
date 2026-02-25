---
description: Create a Docker image for the project, set up container commands, and register them in CLAUDE.md
arguments:
  - name: action
    description: "Optional action: build, deploy, stop, start, delete, rebuild, or empty for full setup"
    required: false
---

You are a Docker deployment assistant for this project. The project already has a `Dockerfile` (multi-stage, node:20-alpine, non-root user, health check on `/api/health`). The internal container port is **3000**.

## Your Task

Based on the action argument "$ARGUMENTS", perform the appropriate operation below.

---

## If no action or action is "setup" — Full Interactive Setup

### Step 1: Gather Information

Ask the user the following questions using AskUserQuestion (all in a single call):

1. **Image name**: "What should the Docker image be named?" (e.g., `azure-fs-api`, `my-project-api`)
2. **Container name**: "What should the container be named? (Recommended: same as image name)"
3. **Host port**: "What host port should the container be mapped to? (The internal port is 3000)"

### Step 2: Validate .env File for Docker Compatibility

Read the `.env` file and check for values wrapped in double quotes (e.g., `KEY="value"`). Docker's `--env-file` reads values **literally** and does NOT strip quotes, so `"value"` becomes the actual value including the quote characters.

If quoted values are found:
- Show the user which variables have quotes
- Remove the double quotes from all variable values in `.env`
- Confirm the fix

### Step 3: Verify Dockerfile Exists

Check that a `Dockerfile` exists in the project root. If not, inform the user and stop.

### Step 4: Build the Docker Image

Run:
```
docker build -t <image-name> .
```

Verify the build succeeds. If it fails, show the error and stop.

### Step 5: Deploy the Container

Run:
```
docker run -d --name <container-name> --env-file .env -e DOCKER_HOST_URL=http://localhost:<host-port> -p <host-port>:3000 <image-name>
```

Wait 3 seconds, then verify:
- Container is running (`docker ps`)
- Health check passes (`curl -s http://localhost:<host-port>/api/health`)

### Step 6: Register Commands in CLAUDE.md

Find the `## Docker Deployment` section in `CLAUDE.md` (or create one if missing). Update the `### Container Commands` subsection with these exact commands using the user's chosen names and port:

**Build image:**
```
docker build -t <image-name> .
```

**Start container:**
```
docker run -d --name <container-name> --env-file .env -e DOCKER_HOST_URL=http://localhost:<host-port> -p <host-port>:3000 <image-name>
```

**Stop container:**
```
docker stop <container-name>
```

**Delete container:**
```
docker rm <container-name>
```

**Delete image (stops container first):**
```
docker stop <container-name> 2>/dev/null; docker rm <container-name> 2>/dev/null; docker rmi <image-name>
```

**Rebuild image (stop, delete, rebuild, redeploy):**
```
docker stop <container-name> 2>/dev/null; docker rm <container-name> 2>/dev/null; docker rmi <image-name> 2>/dev/null; docker build -t <image-name> . && docker run -d --name <container-name> --env-file .env -e DOCKER_HOST_URL=http://localhost:<host-port> -p <host-port>:3000 <image-name>
```

### Step 7: Confirm

Show a summary table of what was done:
- Image name, container name, host port
- Container status and health check result
- CLAUDE.md updated

---

## Action-Specific Operations

If the user provides an action argument, read the `## Docker Deployment` > `### Container Commands` section from `CLAUDE.md` to get the registered image name, container name, and port. Then execute the matching action:

### action = "build"
Run the **Build image** command from CLAUDE.md.

### action = "deploy"
Run the **Start container** command from CLAUDE.md. Wait 3 seconds and verify health.

### action = "stop"
Run the **Stop container** command from CLAUDE.md.

### action = "start"
Run the **Start container** command from CLAUDE.md. Wait 3 seconds and verify health.

### action = "delete"
Run the **Delete image** command from CLAUDE.md (stops container first).

### action = "rebuild"
Run the **Rebuild image** command from CLAUDE.md. Wait 3 seconds and verify health.

---

## Important Rules

- The internal container port is always **3000** (set in the Dockerfile)
- Always use `--env-file .env` — never bake secrets into the image
- Always use `-d` (detached mode) when starting containers
- Use `2>/dev/null` on stop/rm/rmi to suppress errors when container/image doesn't exist
- After any deploy/start/rebuild, verify the container is running and the health endpoint responds
- Never modify the Dockerfile itself — only register commands in CLAUDE.md
