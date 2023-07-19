---
title: "tRPC as Microservices"
description: "How to split tRPC into smaller pieces"
pubDate: "Jun 18 2023"
heroImage: "/assets/trpc-as-microservices.png"
---

> Move Fast and Break Nothing.

[tRPC](https://trpc.io) is a framework for building end-to-end typesafe APIs. It provides a fantastic DX and a huge productivity boost for developers. In addition to the DX, it also supports serverless/edge function deployments out of the box through various adapters such as [AWS Lambda + API Gateway](https://trpc.io/docs/server/adapters/aws-lambda), [Vercel](https://github.com/trpc/trpc/tree/main/examples/vercel-edge-runtime) and [more](https://trpc.io/docs/server/adapters/fetch).

In this article, we will be looking at ways to deploy and serve tRPC in a serverless/edge function environment, and take the scalability to the next level by splitting tRPC into smaller pieces.

I'll be using AWS Lambda + API Gateway throughout this article, but the same concept applies to other serverless function/edge environments as well.

## Step I: tRPC on serverless functions

Let's first get started with the basics. We will be deploying tRPC as a whole in the form of a microservice using AWS Lambda. This step is pretty much the same as the [official guide on how to deploy on AWS Lambda + API Gateway](https://trpc.io/docs/server/adapters/aws-lambda).

I'll assume that you already have a tRPC server set up. If not, you can follow the [official guide](https://trpc.io/docs/server/getting-started) to get started.

The core of a serverless function lives in its handler function. In tRPC, we can implement the handler function as follows:

```typescript
import {
	CreateAWSLambdaContextOptions,
	awsLambdaRequestHandler,
} from "@trpc/server/adapters/aws-lambda"
const appRouter = /* ... */
// created for each request
const createContext = ({
	event,
	context,
}: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>) => ({}) // no context

type Context = trpc.inferAsyncReturnType<typeof createContext>
export const handler = awsLambdaRequestHandler({
	router: appRouter,
	createContext,
})
```
> source: https://trpc.io/docs/server/adapters/aws-lambda

Deployment can't be easier. Once you have the dependencies installed, you can simply build the code & upload the build to AWS Lambda and set up the API Gateway. Because tRPC basically runs on an HTTP server, it is no surprise to us that serverless function deployment is easy as any other HTTP frameworks.

For the ease deployment of multiple services on AWS and to avoid the hassle of setting up API Gateway manually, I'll be using AWS CDK to deploy this function. You can use any other deployment tools such as Terraform or Serverless Framework.

Here, I've placed the build output in `backend/build.lambda`. The CDK code is as follows:

```typescript
import path from 'path'

import * as cdk from 'aws-cdk-lib'
import * as apigateway from 'aws-cdk-lib/aws-apigateway'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import type { Construct } from 'constructs'

export class TRPCStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props)
		const handler = new lambda.Function(this, 'trpc-handler', {
			runtime: lambda.Runtime.NODEJS_18_X,
			code: lambda.Code.fromAsset(
				path.resolve(__dirname, '..', 'backend', 'build.lambda'),
			),
			handler: 'index.handler',
			memorySize: 512,
			timeout: cdk.Duration.seconds(90),
		})
		const api = new apigateway.LambdaRestApi(this, 'trpc-api', {
			handler,
			proxy: true,
			deploy: true,
			deployOptions: {
				stageName: 'staging',
			},
		})
	}
}
```

## Step II: Splitting tRPC into smaller pieces

Now that we have a basic understanding of how to deploy tRPC on serverless functions, let's take a look at how we can split tRPC into smaller pieces.

### Why split?

Before we dive into the details, let's first take a look at why we should split tRPC into smaller pieces.

**MSA**, or **Microservice Architecture**, is a software architecture that divides a single application into smaller services. Each service is independent and can be deployed and scaled independently. This architecture is specifically useful when the application serves multiple purposes & requires high scalability. Certain parts of the application may require more resources than others, and it is not efficient to scale the entire application when only a part of it requires more resources.

In short,
- You can scale each service independently
- You can reduce the risk of downtime by not keeping all your eggs in a single basket
- Code deployment & maintenance is easier with multiple developers working on different services

And as you will find out soon, tRPC is *the perfect fit* for MSA.

### How to split?

The core of this architecture lies in the separation of the router. In tRPC, you can separate routes into different routers and combine them into a single router. The root router, containing all the child routers combined, is often referred to as the `appRouter`.

Suppose we have a tRPC router that looks like this:

```typescript

import { router, procedure } from "../trpc"

export const taskRouter = router({
    create: procedure
        .input( 
            z.object({
                content: z.string(),
            }))
        .mutation(
            async ({
                input: { content },
            }) => {
                /* ... */
            }
        ),
    markAsDone: procedure
        .input( 
            z.object({
                id: z.string(),
            }))
        .mutation(
            async ({
                input: { content },
            }) => {
                /* ... */
            }
        ),
})

```

The `taskRouter` exported here would be imported in the implementation of the root router, `appRouter`, as follows:

```typescript
import { router } from "../trpc"
import { taskRouter } from "./task"

export const appRouter = router({
    tasks: taskRouter,
})
```

In real-life situations, your `appRouter` would likely have more than a few child routers, like this:

```typescript
import { router } from "../trpc"
import { taskRouter } from "./task"
import { userRouter } from "./user"

export const appRouter = router({
    tasks: taskRouter,
    users: userRouter,
})
```

### Any router can be a root router

Note that the `appRouter` is not special in any way. It is just a router that contains other routers. This means that any router can be a root router. This is the key to splitting tRPC into smaller pieces.

Back to the `taskRouter` example, we can make it a root router by using the `taskRouter` just like a root router:

```typescript
import {
	CreateAWSLambdaContextOptions,
	awsLambdaRequestHandler,
} from "@trpc/server/adapters/aws-lambda"
// We import the taskRouter here
import { taskRouter } from "./task"

// created for each request
const createContext = ({
	event,
	context,
}: CreateAWSLambdaContextOptions<APIGatewayProxyEventV2>) => ({}) // no context

type Context = trpc.inferAsyncReturnType<typeof createContext>
export const handler = awsLambdaRequestHandler({
    // ...and use it just like a root router
	router: taskRouter,
	createContext,
})
```

This lambda handler will only handle requests to the `taskRouter`. This means that we can deploy this lambda handler as a separate service, and it will only handle requests to the `taskRouter`.

The same can be applied to any other routers. In the case of the example above, you can deploy the `userRouter` as a separate service, and it will only handle requests to the `userRouter`.

We have successfully split tRPC into smaller pieces & figured out how to deploy them as separate services. Now, let's take a look at how we can combine them back into a single endpoint.

## Step III: Combining tRPC into a single endpoint

Now that we have split tRPC into microservices, we need to combine them back into a single endpoint in order to use them in the frontend. 

I will introduce two methods to combine tRPC into a single endpoint. One is through using the API Gateway, which is an easier approach that handles the routing on the cloud so that the frontend won't even notice that its running on an MSA. The other is through using tRPC links, which is a more flexible/generally compatible approach that allows you to customize the routing on the frontend.

### Method A: Using API Gateway

Once you have deployed the lambda handlers, you can use the API Gateway to combine them into a single endpoint.

Before anything else, we need to understand how tRPC handles routing for child routers. The [HTTP RPC Specification](https://trpc.io/docs/rpc) on the official tRPC documentation (kind of) explains this. A child route would be prefixed with the name of the child router. For example, if we have a child router of key `tasks` that contains a route named `create`, the full route name would be `/tasks.create`.

We can use the API Gateway to apply this logic to the routing of the lambda handlers. API Gateway allows you to create a route that matches a pattern. For example, if you create a route that matches the pattern `/tasks.*`, it will match all routes that start with `/tasks.`. This means that we can create a route that matches the pattern `/tasks.*` and route it to the lambda handler that handles the `taskRouter`. We can do the same for the `userRouter` and any other routers.

### Method B: Using tRPC links

If you are using another cloud provider that does not support router-level customization, or if you want to customize the routing on the frontend, you can use tRPC links to combine the lambda handlers into a single endpoint.

[tRPC links](https://trpc.io/docs/client/links) allows you to customize the data flow between the frontend and the backend. This means that you could also control which endpoint is being used to resolve a request on the frontend. The key logic lies in the `splitLink`, which gives us direct control of which endpoint is being used to resolve a request.

So, in order to control which endpoint is being used depending on the route, we can create a link that matches the route name and set the http url to the corresponding endpoint.

```typescript
import {
  createTRPCProxyClient,
  httpLink,
  splitLink,
} from '@trpc/client';
import type { AppRouter } from '../server';

const tasksURL = 'https://...';
const usersURL = 'https://...';

const client = createTRPCProxyClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.path.startsWith("tasks"),
      true: httpLink({ url: tasksURL }),
      false: httpBatchLink({ url: usersURL }),
    }),
  ],
});
```

In this example, all requests to the `tasks` router will be sent to the `tasksURL`, and all other requests will be sent to the `usersURL`. In production, you would likely have multiple `splitLink`s to decide which endpoint to use depending on the route.

It would be great to have a `splitLink`-like link that allows you to decide between multiple links like `switch` statements or pattern matching, but unfortunately, there is no such link at the moment. But still, `splitLink` does the job just fine.

## Conclusion

In this article, I went over on how to split tRPC into microservices through AWS Lambda and API Gateway and combine them back into a single endpoint on both cloud level and client level. The same concept should apply on any other cloud providers. Keep in mind that the general idea behind this approach is that tRPC is already designed to be split into smaller pieces, so you don't have to do anything special (other than setting up function handlers & deployments) to split it into microservices.

I hope this article was helpful to you. If you have any questions or feedback, please feel free to reach out to me on [Twitter](https://twitter.com/e_sinx). Thank you for reading!