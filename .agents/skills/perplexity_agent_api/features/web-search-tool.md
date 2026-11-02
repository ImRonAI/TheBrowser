> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Web Search

> Search the web from the Agent API with filters, search configurations, pricing, parameters, and response fields.

## Overview

The `web_search` tool lets the model search the web during an Agent API request. Use it for current information, recent news, source-grounded research, and questions that need information beyond the model's training data.

Enable the tool by adding it to the `tools` array. The model decides when to call it based on your prompt and instructions.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Explain the architecture of NVIDIA's CUDA programming model: threads, blocks, grids, warps, and memory hierarchy, and how they enable GPU parallelism.",
      tools=[
          {
              "type": "web_search",
              "search_context_size": "medium"
          }
      ],
      instructions="Search for current, source-grounded information before answering.",
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Explain the architecture of NVIDIA\'s CUDA programming model: threads, blocks, grids, warps, and memory hierarchy, and how they enable GPU parallelism.',
    tools: [
      {
        type: 'web_search' as const,
        search_context_size: 'medium',
      },
    ],
    instructions: 'Search for current, source-grounded information before answering.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Explain the architecture of NVIDIA\u0027s CUDA programming model: threads, blocks, grids, warps, and memory hierarchy, and how they enable GPU parallelism.",
      "tools": [
        {
          "type": "web_search",
          "search_context_size": "medium"
        }
      ],
      "instructions": "Search for current, source-grounded information before answering."
    }' | jq
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "c6e956f3-0667-40d1-9f47-ab3f5afa9bf7",
    "results": [
      {
        "snippet": "",
        "title": "CUDA C++ Programming Guide - NVIDIA Documentation Hub",
        "url": "https://docs.nvidia.com/cuda/cuda-c-programming-guide/",
        "date": "2026-04-02",
        "last_updated": "2026-05-21"
      },
      {
        "snippet": "",
        "title": "CUDA Live: Your Parallel Programming Guide - YouTube",
        "url": "https://www.youtube.com/watch?v=ftI48A8K5Vg",
        "date": "2026-02-19",
        "last_updated": "2026-05-20"
      },
      {
        "snippet": "CUDA\nCUDA, which stands for Compute Unified Device Architecture, is a parallel computing platform and application programming interface (API) model created by NVIDIA.\nIt allows software developers and software engineers to use a CUDA-enabled graphics processing unit (GPU) for general-purpose processing purposes - an approach known as GPGPU (General-Purpose computing on Graphics Processing Units).\nCUDA gives programmers access to the virtual instruction set and memory of the parallel computational elements in CUDA-enabled GPUs.\nUsing CUDA, developers can significantly speed up compute-intensive applications by harnessing the power of GPUs for non-graphical computing.\n...\nToday, CUDA is typically harnessed by enabling a CPU to offload complex computational tasks to a GPU.\nThis can often result in a drastic increase in computing efficiency because GPUs are exceptionally efficient at handling multiple operations simultaneously due to their parallel processing capabilities.\n...\nOne of the key strengths of CUDA is its ability to make parallel computing more accessible and efficient.\nBy leveraging the massive parallel processing power of NVIDIA GPUs, CUDA enables dramatic increases in computing performance.\n...\n1. Parallel Processing Capabilities: CUDA enables hundreds or even thousands of computing cores on a GPU to perform simultaneous calculations, vastly outperforming CPUs on tasks that can be parallelized.\n...\n3. Advanced Memory Management: CUDA provides efficient and fine-grained control over memory usage on GPUs, allowing for optimized performance.\n...\nYes, CUDA is a proprietary computing platform developed by NVIDIA for their GPUs only.\nIt is specifically designed to work with NVIDIA graphics cards and, therefore, is not compatible with GPUs from other manufacturers.\n...\n4. How does CUDA differ from traditional CPU processing?\nCUDA allows for parallel processing, harnessing the power of GPU cores, which can handle thousands of threads simultaneously, offering a significant speed advantage over traditional CPU processing for certain tasks.\n...\nTo enable CUDA on a compatible NVIDIA GPU, you need to install the NVIDIA CUDA Toolkit and the appropriate GPU drivers from NVIDIA's website.\nThe toolkit includes libraries, debugging and optimization tools, a runtime library, and a C compiler.",
        "title": "What Is CUDA? - Supermicro",
        "url": "https://www.supermicro.com/en/glossary/cuda",
        "date": null,
        "last_updated": "2026-05-16"
      },
      {
        "snippet": "",
        "title": "1.2. Programming Model — CUDA Programming Guide",
        "url": "https://docs.nvidia.com/cuda/cuda-programming-guide/01-introduction/programming-model.html",
        "date": "2026-03-04",
        "last_updated": "2026-05-04"
      },
      {
        "snippet": "GPU (Graphics Processing Unit) architecture is the foundation of modern computing, designed to handle complex parallel processing tasks with incredible efficiency.\nUnlike traditional CPUs, which excel at sequential operations, GPUs are optimized for massive parallelism, making them indispensable for high-performance computing, artificial intelligence (AI) workloads, and virtualization.\n...\nGPUs excel in executing thousands of parallel operations, making them superior to CPUs for tasks such as deep learning and real-time analytics.\nThis advantage is key for industries requiring high-speed data processing.\nIn AI training, GPUs break complex computations into smaller tasks that run simultaneously across thousands of cores, dramatically accelerating model development.\nIn fields such as medical imaging and logistics optimization, parallel processing enables near-instantaneous analysis of vast data sets, leading to faster insights and decision-making.\n...\nGPU architecture refers to the design and structure of a graphics processing unit, optimized for parallel computing.\nIt is crucial for high-performance computing, AI, and graphics-intensive applications.\n...\nThe main layers include the hardware layer (physical components), firmware and driver layer (optimization and compatibility), and software and API layer (programming interfaces for application development).\n...\nGPUs outperform CPUs in AI and machine learning due to their ability to handle thousands of parallel computations simultaneously, significantly speeding up training and inference processes.",
        "title": "GPU Architecture Explained: Structure, Layers & Performance",
        "url": "https://www.scalecomputing.com/resources/understanding-gpu-architecture",
        "date": "2025-04-16",
        "last_updated": "2026-05-14"
      },
      {
        "snippet": "CUDA is a parallel computing platform and programming model developed by NVIDIA that enables dramatic increases in computing performance by harnessing the power of the GPU.\nIt allows developers to accelerate compute-intensive applications and is widely used in fields such as deep learning, scientific computing, and high-performance computing (HPC).",
        "title": "CUDA Programming Guide",
        "url": "https://docs.nvidia.com/cuda/cuda-programming-guide/index.html",
        "date": "2026-03-04",
        "last_updated": "2026-05-02"
      },
      {
        "snippet": "6\nClosely Coupled CPU-GPU\nOperation 1\nOperation 2\nOperation 3\nInit\nAlloc\nFunction\nLib\nLib\nFunction\nFunction\nCPU\nGPU\nIntegrated programming model\nHigh speed data transfer – up to 3.2 GB/s\nAsynchronous operation\nLarge GPU memory systems\n© NVIDIA Corporation 2006-2008\n...\n17\nGPU Computing\nGPU is a massively parallel processor\nNVIDIA G80: 128 processors\nSupport thousands of active threads (12,288 on G80)\nGPU Computing requires a programming model that \ncan efficiently express that kind of parallelism\nMost importantly, data parallelism\nCUDA implements such a programming model\n© NVIDIA Corporation 2006-2008\n18\nCUDA Kernels and Threads\nParallel portions of an application are executed on \nthe device as kernels\nOne kernel is executed at a time\nMany threads execute each kernel\nDifferences between CUDA and CPU threads \nCUDA threads are extremely lightweight\nVery little creation overhead\nInstant switching\nCUDA uses 1000s of threads to achieve efficiency\nMulti-core CPUs can use only a few\nDefinitions: \nDevice = GPU; Host = CPU\nKernel = function that runs on the device\n© NVIDIA Corporation 2006-2008\n19\nArrays of Parallel Threads\nA CUDA kernel is executed by an array of threads\nAll threads run the same code\nEach thread has an ID that it uses to compute memory \naddresses and make control decisions\n7\n6\n...\nThe Missing Piece: threads may need to cooperate\nThread cooperation is valuable\nShare results to save computation\nSynchronization\nShare memory accesses\nDrastic bandwidth reduction\nThread cooperation is a powerful feature of CUDA\n...\nThread Blocks: Scalable Cooperation\nDivide monolithic thread array into multiple blocks\nThreads within a block cooperate via shared memory\nThreads in different blocks cannot cooperate\nEnables programs to transparently scale to any \nnumber of processors!\n...\nHardware is free to schedule thread blocks \n...\nA kernel scales across any number of parallel \nmultiprocessors\n...\n23\nCUDA Programming Model\nA kernel is executed by a \ngrid of thread blocks\nA thread block is a batch \nof threads that can \ncooperate with each \nother by:\nSharing data through \nshared memory\nSynchronizing their \nexecution\nThreads from different\nblocks cannot cooperate\nHost\nKernel \n...\n24\nProcessors     execute computing threads\nThread Execution Manager issues threads\n128 Thread Processors grouped into 16 Multiprocessors (SMs)\nParallel Data Cache (Shared Memory) enables thread \ncooperation\n...\nThread and Block IDs\nThreads and blocks have IDs\nEach thread can decide what \ndata to work on\nBlock ID: 1D or 2D\nThread ID: 1D, 2D, or 3D \nSimplifies memory\naddressing when processing\nmulti-dimensional data\nImage processing\nSolving PDEs on volumes\n...\nKernel Memory Access\nRegisters\nGlobal Memory (external DRAM)\nKernel input and output data reside here\nOff-chip, large\nUncached\nShared Memory (Parallel Data Cache)\nShared among threads in a single block\nOn-chip, small\nAs fast as registers\nGrid\n...\nThe host can read & write global memory but not shared memory\n...\n27\nExecution Model\nKernels are launched in grids\nOne kernel executes at a time\nA block executes on one Streaming Multiprocessor \n(SM)\nDoes not migrate\nSeveral blocks can reside concurrently on one SM\nControl limitations (of G8X/G9X GPUs):\nAt most 8 concurrent blocks per SM\nAt most 768 concurrent threads per SM\nNumber is further limited by SM resources\nRegister file is partitioned among all resident threads\nShared memory is partitioned among all resident thread blocks\n...\nCUDA Advantages over Legacy GPGPU\n(Legacy GPGPU is programming GPU through graphics APIs)\nRandom access byte-addressable memory\nThread can access any memory location\nUnlimited access to memory\nThread can read/write as many locations as needed\nShared memory (per block) and thread \nsynchronization\nThreads can cooperatively load data into shared memory\nAny thread can then access any shared memory location\nLow learning curve\nJust a few extensions to C\nNo knowledge of graphics is required\nNo graphics API overhead\n...\n29\nCUDA Model Summary\nThousands of lightweight concurrent threads\nNo switching overhead\nHide instruction and memory latency\nShared memory\nUser-managed L1 cache\nThread communication / cooperation within blocks\nRandom access to global memory\nAny thread can read/write any location(s)\nCurrent generation hardware:\nUp to 128 streaming processors\nMemory\nLocation\nCached\nAccess\nScope (“Who?”)\nShared\nOn-chip\nN/A\nRead/write\nAll threads in a block\nGlobal\nOff-chip\nNo\nRead/write\nAll threads + host\n© NVIDIA Corporation 2006-2008",
        "title": "[PDF] NVIDIA CUDA Software and GPU Parallel Computing Architecture",
        "url": "https://www.isfpga.org/past/fpga2008/fpga2008%20workshop%20-%2006%20NVIDIA%20-%20Kirk.pdf",
        "date": null,
        "last_updated": "2026-03-10"
      },
      {
        "snippet": "Parallel Computing on a GPU\nNVIDIA GPU Computing Architecture\nis a scalable parallel computing platform\nIn laptops, desktops, workstations, servers\n8-series GPUs deliver 50 to 200 GFLOPS\non compiled parallel C applications\nGPU parallel performance pulled by the\ninsatiable demands of PC game market\nGPU parallelism is doubling every year\nProgramming model scales transparently\nProgrammable in C with CUDA tools\nMultithreaded SPMD model uses application\ndata parallelism and thread parallelism\nGeForce 8800\n...\nNVIDIA 8-Series GPU Computing\nMassively multithreaded parallel computing platform\n12,288 concurrent threads, hardware managed\n128     Thread Processor cores at 1.35 GHz  == 518 GFLOPS peak\nGPU Computing features enable C on Graphics Processing Unit\nSP\n© NVIDIA Corporation 2007\n...\nProgrammer Partitions Problem\nwith Data-Parallel Decomposition\nCUDA Programmer partitions\nproblem into Grids, one Grid\nper sequential problem step\nProgrammer partitions Grid\ninto result Blocks computed\nindependently in parallel\nGPU thread array computes\nresult Block\nProgrammer partitions Block\ninto elements computed\ncooperatively in parallel\nGPU thread computes result\nelement\nGPU\nGrid 1\nBlock\n(0, 0)\n...\nCooperative Thread Array\nCTA Implements CUDA Thread Block\nA CTA is an array of concurrent threads\nthat cooperate to compute a result\nA CUDA thread block is a CTA\nProgrammer declares CTA:\nCTA size 1 to 512 concurrent threads\nCTA shape 1D, 2D, or 3D\nCTA dimensions in threads\nCTA threads execute thread program\nCTA threads have thread id numbers\nCTA threads share data and synchronize\nThread program uses thread id to select\nwork and address shared data\nCTA\nCUDA Thread Block\nThread Id #:\n0 1 2 3 …          m\nThread program\n...\nSM Multiprocessor Executes CTAs\nCTA threads run concurrently\nSM assigns thread id #s\nSM manages thread execution\nCTA threads share data & results\nIn Memory and Shared Memory\nSynchronize at barrier instruction\nPer-CTA Shared Memory\nKeeps data close to processor\nMinimize trips to global Memory\nCTA threads access global Memory\n...\nData Parallel Levels\n...\nCTA – Cooperative Thread Array\n...\n1 to 512 threads per CTA\nCTA (Block) id number\n...\nComputes many result Blocks\n...\nParallel Memory Sharing\nLocal Memory:   per-thread\nPrivate per thread\nAuto variables, register spill\nShared Memory:   per-CTA\nShared by threads of CTA\nInter-thread communication\nGlobal Memory:   per-application\nShared by all threads\nInter-Grid communication\nThread\nLocal Memory\n...\nGPU parallelism varies widely\nRanges from 8 cores to many 100s of cores\nRanges from 100 to many 1000s of threads\nGPU parallelism doubles yearly\nGraphics performance scales with GPU parallelism\nData parallel mapping of pixels to threads\nUnlimited demand for parallel pixel shader threads and cores\nChallenge:\nScale Computing performance with GPU parallelism\nProgram must be insensitive to the number of cores\nWrite one program for any number of SM cores\nProgram runs on any size GPU without recompiling\n...\n13\nTransparent Scalability\nProgrammer uses multi-level data parallel decomposition\nDecomposes problem into sequential steps (Grids)\nDecomposes Grid into computing parallel Blocks (CTAs)\nDecomposes Block into computing parallel elements (threads)\nGPU hardware distributes CTA work to available SM cores\nGPU balances CTA work load across any number of SM cores\nSM core executes CTA program that computes Block\nCTA program computes a Block independently of others\nEnables parallel computing of Blocks of a Grid\nNo communication among Blocks of same Grid\nScales one program across any number of parallel SM cores\nProgrammer writes one program for all GPU sizes\nProgram does not know how many cores it uses\nProgram executes on GPU with any number of cores\n© NVIDIA Corporation 2007\n...\n14\nCUDA Programming Model:\nParallel Multithreaded Kernels\nExecute data-parallel portions of application on\nGPU as kernels which run in parallel on many\ncooperative threads\nIntegrated CPU + GPU application C program\nPartition problem into a sequence of kernels\nKernel C code executes on GPU\nSerial C code executes on CPU\nKernels execute as blocks of parallel threads\nView GPU as a computing device that:\nActs as a coprocessor to the CPU host\nHas its own memory\nRuns many lightweight threads in parallel\n© NVIDIA Corporation 2007\n...\nCUDA integrated CPU + GPU application C program\nSerial C code executes on CPU\nParallel Kernel C code executes on GPU thread blocks\n...\n16\nCUDA Programming Model:\nGrids, Blocks, and Threads\nExecute a sequence of kernels\non GPU computing device\nA kernel executes as a Grid of\nthread blocks\nA thread block is an array of\nthreads that can cooperate\nThreads within the same block\nsynchronize and share data in\nShared Memory\nExecute thread blocks as CTAs\non multithreaded\nmultiprocessor SM cores\nCPU\nKernel 1\nKernel 2\nGPU device\n...\n17\nCUDA Programming Model:\nThread Memory Spaces\nEach kernel thread can read:\nThread Id \nper thread\nBlock Id \nper block\nConstants\nper grid\nTexture    \nper grid\nEach thread can read and write:\nRegisters\nper thread\nLocal memory\nper thread\nShared memory per block\nGlobal memory per grid\nHost CPU can read and write:\nConstants\nper grid\nTexture    \nper grid\nGlobal memory per grid\nThread Id,  Block Id\nRegisters\nConstants\nTexture\nGlobal Memory\nShared\nMemory\nKernel\nThread\nProgram\nWritten in C\nLocal Memory\n...\n18\nCUDA: C on the GPU\nSingle-Program Multiple-Data (SPMD) programming model\nC program for a thread of a thread block in a grid\nExtend C only where necessary\nSimple, explicit language mapping to parallel threads\nDeclare C kernel functions and variables on GPU:\n__global__ void KernelFunc(...);\n__device__ int  GlobalVar;\n__shared__ int  SharedVar;\nCall kernel function as Grid of 500 blocks of 128 threads:\nKernelFunc<<< 500, 128 >>>(args ...);\nExplicit GPU memory allocation, CPU-GPU memory transfers\ncudaMalloc( ), cudaFree( )\ncudaMemcpy( ), cudaMemcpy2D( ), …\n...\nNVIDIA GPU Computing Architecture\nComputing mode enables parallel C on GPUs\nMassively multithreaded – 1000s of threads\nExecutes parallel threads and thread arrays\nThreads cooperate via Shared and Global memory\nScales to any number of parallel processor cores\nNow on: Tesla C870, D870, S870, GeForce 8800/8600/8500,\nand Quadro FX 5600/4600\nCUDA Programming model\nC program for GPU threads\nScales transparently to GPU parallelism\nCompiler, tools, libraries, and driver for GPU Computing\nSupports Linux and Windows",
        "title": "[PDF] GPU Parallel Computing Architecture and CUDA Programming Model",
        "url": "https://old.hotchips.org/wp-content/uploads/hc_archives/hc19/2_Mon/HC19.02/HC19.02.02.pdf",
        "date": null,
        "last_updated": "2025-11-04"
      },
      {
        "snippet": "",
        "title": "4.18. CUDA Dynamic Parallelism — CUDA Programming Guide",
        "url": "https://docs.nvidia.com/cuda/cuda-programming-guide/04-special-topics/dynamic-parallelism.html",
        "date": "2026-03-04",
        "last_updated": "2026-05-03"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

## Configuring Search

### Search Type

Set `search_type` to `"fast"` to run each `web_search` call on the lower-latency Fast Search path. Fast calls cost \$1.00 per 1,000 invocations instead of \$2.50, plus model tokens. Set `search_type` to `"web"` for standard web search. If you omit it, the tool inherits the preset's search type when one is configured; otherwise, it uses `"web"`.

Use `fast` for day-to-day agent loops and high-volume tool calls. Use `web` for rare, difficult, or ambiguous questions. `search_type` is separate from the Agent API [`fast` preset](/docs/agent-api/presets).

First, [install a library and set `PERPLEXITY_API_KEY`](/docs/agent-api/quickstart). The examples below work with Perplexity Python library 0.43.5 and TypeScript SDK 0.38.5. Python accepts `search_type` inside the tool object. TypeScript needs the `as any` cast shown below because its tool type does not yet include this field.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-luna",
      input="What is the latest stable Rust release, and what changed?",
      tools=[
          {
              "type": "web_search",
              "search_type": "fast"
          }
      ]
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
      model: "openai/gpt-5.6-luna",
      input: "What is the latest stable Rust release, and what changed?",
      tools: [
          {
              type: "web_search",
              search_type: "fast"
          } as any // The current SDK types do not yet include search_type on web_search.
      ]
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-luna",
      "input": "What is the latest stable Rust release, and what changed?",
      "tools": [
        {
          "type": "web_search",
          "search_type": "fast"
        }
      ]
    }' | jq
  ```
</CodeGroup>

You can combine `search_type` with `search_context_size`, `max_results`, and `filters`, as described below.

### Using Recommended Token Budgets

Start with `low`, `medium`, or `high` for search context sizing via `search_context_size`. Each named size maps to a recommended pair of `max_tokens` and `max_tokens_per_page` budgets and is the recommended default for most applications.

| `search_context_size` | `max_tokens` | `max_tokens_per_page` | Best for |
| - | - | - | - |
| `low` | 300 | 300 | Simple facts and lightweight lookups |
| `medium` | 1,000 | 1,000 | General research and product comparisons |
| `high` | 4,000 | 4,000 | Source-heavy answers and complex research |

<Note>
  These token-budget mappings reflect Perplexity's current recommended defaults and may change as we ship updated configurations based on the latest evaluation results. Calling a named size always resolves to the current recommended budget.
</Note>

<CodeGroup>
  ```python Python theme={null}
  tools = [
      {
          "type": "web_search",
          "search_context_size": "high"
      }
  ]
  ```

  ```typescript Typescript theme={null}
  const tools = [
    {
      type: 'web_search' as const,
      search_context_size: 'high',
    },
  ];
  ```

  ```bash cURL theme={null}
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "high"
    }
  ]
  ```
</CodeGroup>

### Advanced Token Budget Configuration

Use explicit token budgeting when you need to pin exact budgets for cost controls, latency controls, or evaluations. Set `max_tokens` to cap total search context across results, and set `max_tokens_per_page` to cap content extracted from each result page. Explicit budgets override any `search_context_size` value passed in the same request, and you are charged for the exact number of search context tokens consumed, not the requested budget.

<CodeGroup>
  ```python Python theme={null}
  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Summarize the US OMB M-24-10 memorandum on AI procurement: scope, key requirements for federal agencies, and the rights-impacting AI categories.",
      tools=[
          {
              "type": "web_search",
              "max_tokens": 6000,
              "max_tokens_per_page": 1200,
              "filters": {
                  "search_domain_filter": [".gov"],
                  "search_recency_filter": "month"
              }
          }
      ],
  )
  ```

  ```typescript Typescript theme={null}
  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Summarize the US OMB M-24-10 memorandum on AI procurement: scope, key requirements for federal agencies, and the rights-impacting AI categories.',
    tools: [
      {
        type: 'web_search' as const,
        max_tokens: 6000,
        max_tokens_per_page: 1200,
        filters: {
          search_domain_filter: ['.gov'],
          search_recency_filter: 'month',
        },
      },
    ],
  });
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Summarize the US OMB M-24-10 memorandum on AI procurement: scope, key requirements for federal agencies, and the rights-impacting AI categories.",
      "tools": [
        {
          "type": "web_search",
          "max_tokens": 6000,
          "max_tokens_per_page": 1200,
          "filters": {
            "search_domain_filter": [".gov"],
            "search_recency_filter": "month"
          }
        }
      ]
    }' | jq
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "75a4ee6f-ac57-4ed1-ad17-ad2d54f70428",
    "results": [
      {
        "snippet": "",
        "title": "[PDF] M-24-10 MEMORANDUM FOR THE HEADS OF EXECUTIVE ...",
        "url": "https://www.whitehouse.gov/wp-content/uploads/2024/03/M-24-10-Advancing-Governance-Innovation-and-Risk-Management-for-Agency-Use-of-Artificial-Intelligence.pdf",
        "date": null,
        "last_updated": "2026-03-30"
      },
      {
        "snippet": "",
        "title": "[PDF] M-24-18 MEMORANDUM FOR THE HEADS OF EXECUTIVE ...",
        "url": "https://www.whitehouse.gov/wp-content/uploads/2024/10/M-24-18-AI-Acquisition-Memorandum.pdf",
        "date": null,
        "last_updated": "2026-03-21"
      },
      {
        "snippet": "",
        "title": "OMB Releases Requirements for Responsible AI Procurement by ...",
        "url": "https://www.cov.com/en/news-and-insights/insights/2024/10/omb-releases-requirements-for-responsible-ai-procurement-by-federal-agencies",
        "date": "2023-04-18",
        "last_updated": "2026-03-25"
      },
      {
        "snippet": "On September 24, 2024, the Office of Management and Budget (OMB) released **Memorandum M-24-18**, *Advancing the Responsible Acquisition of Artificial Intelligence in Government *(Memo).\nThe 36-page Memo builds on OMB’s March 2024 guidance governing federal agencies’ use of AI, Memorandum M-24-10, which we reported on here.\nThe Memo addresses requirements and guidance for agencies acquiring AI systems and services, focusing on three strategic goals: (i) ensuring collaboration across the federal government; (ii) managing AI risks and performance; and (iii) promoting a competitive AI market.\n### Scope and Applicability\nThe Memo’s requirements will apply to contracts awarded under solicitations issued on or after March 23, 2025, as well as to any renewal options or extensions exercised after March 23, 2025.\nThe Memo addresses government-wide considerations associated with agencies’ procurement of an AI system or service.\nFor this purpose, the Memo defines “AI System” to include AI applications and AI integrated into other systems or agency business processes, but does not include “common commercial products” with embedded AI functionality (e.g., common commercial map navigation applications or word processing software that has substantial non-AI purposes or functionalities but for which AI is embedded for functions like suggesting text or correcting spelling and grammar).\nThe Memo also does not apply to AI acquired by elements of the Intelligence Community or acquired for use as a component of a “National Security System” as defined under 44 U.S.C.\n§ 3552(b)(6), and does not apply to:\n- contractors’ incidental use of AI during contract performance (e.g., AI used at the option of a contractor when not directed or required to fulfill requirements);\n- AI acquired to carry out basic, applied, or experimental research (except where the purpose of such research is to develop particular AI applications within the agency);\n- regulatory actions designed to prescribe generally AI law or policy; or\n- evaluations of particular AI applications because the AI provider is the target or potential target of a regulatory enforcement, law enforcement, or national security action.\n...\nThe Memo directs agencies to formalize internal acquisition policies, procedures, and practices to reflect AI acquisition requirements and requires agencies to submit proof of implementation progress and agency-wide coordination to OMB by March 2025.\nThe Memo further directs agencies to work together through interagency councils and other efforts to collaborate and share information about AI acquisition across agencies “to strengthen the marketplace over time by increasing predictability and standardizing expectations for vendors.”\nAccording to the Memo, information collected by agencies on AI acquisition should be shared publicly where possible to provide clarity to contractors, including new entrants.\n...\nThe bulk of the Memo is dedicated to best practices and specific requirements for managing AI risk and performance, directing agencies to prioritize privacy, security, data ownership, and interoperability when planning for an AI acquisition.\n...\nTo determine whether AI covered by Memorandum M-24-18 is being acquired, the Memo directs agency officials responsible for acquisition planning, requirements development, and proposal evaluation to:\n1. Communicate to contractors, to the greatest extent practicable, whether the acquired AI system or service is intended to be used in a manner that could impact rights or safety and trigger additional risk management requirements.\n2. In cases where an agency’s solicitation does not explicitly ask for an AI system, consider requirements language asking contractors to report any proposed use of AI as part of their proposal submissions.\n3. Require contractors to provide a notification to and receive acceptance from relevant agency stakeholders prior to the integration of new AI features or components into systems and services being delivered under contract.\n4. Communicate with contractors to determine when AI is a primary feature or component in an acquired system or service, including questions to the contractor to understand if AI is being used in the evaluation or performance of a contract that does not explicitly involve AI.\n...\nThe Memo includes various recommendations and requirements that could create affirmative requirements for contractors, including that:\n- Agencies should consider including as part of their evaluation criteria how AI vendors demonstrate they are protecting personally identifiable information and mitigating privacy risks, including through privacy-enhancing technologies.\n- Agencies should ensure contractual terms address requirements for vendors to submit systems that use facial recognition for evaluation by NIST as part of the Face Recognition Technology Evaluation and Facial Analytics Technical Evaluation, where practicable.\n- Agencies should require vendors to identify potential AI biases and mitigation strategies to address biases.\n...\nThe Memo suggests that agencies should leverage performance-based contracting approaches and techniques, to strengthen their ability to effectively plan for, identify, and manage risk throughout the contract lifecycle.\n...\nThe Memo requires agencies to scrutinize terms of service and licensing terms, including those that specify what information, models, and transformed agency data should be provided as deliverables to avoid vendor lock-in, and to conduct careful due diligence on the supply chain of a vendor’s data.\nThe best practices outlined in the Memo include contractual restrictions on using agency information to train AI systems.\n...\nThe Memo requires that contract terms explicitly address how a vendor will ensure compliance with relevant data management directives and policies (e.g., through a quality management system), particularly with respect to (i) data that is generated before, during, or after the delivery of the AI; (ii) tiered levels of access and requisite responsibilities of handling data; and (iii) disclosures when copyrighted materials are used in the training data.\n...\nAccording to the Memo, agencies should include contractual requirements that facilitate the ability to obtain any documentation and access necessary to understand how a model was trained.\nFor example, agencies may request training logs from a contractor, including evidence of any data sourcing, cleansing, inputs, parameters, or hyper-parameters used during training sessions for models delivered to the government.\nContractors may also be asked to provide detailed documentation of the training procedure used for the model to demonstrate the model’s authenticity, provenance, and security, and to make trained model artifacts available for agency evaluation and review.\n#### Rights-Impacting AI and Safety-Impacting AI\nWhere practicable, agencies must disclose in solicitations whether the planned use is rights-impacting or safety-impacting.\nAgencies must consider whether various categories of information must be provided by the vendor to satisfy the requirements of OMB Memorandum M-24-10 or to meet the agency’s objectives, including, e.g., performance metrics and information about data source, provenance, selection, quality, and appropriateness and fitness-for-purpose.\nContracts should delineate responsibilities for ongoing testing and monitoring, set criteria for risk mitigation, and prioritize performance improvement.\nContractors could also be required to have a process for identifying and disclosing serious AI incidents and malfunctions of an acquired AI system or service within 72 hours, or a timely manner based on the severity of the incident.\nFor new or existing contracts involving agency use of rights-impacting AI systems or services, agencies must disclose OMB Memorandum M-24-10’s notice and appeal requirements to contractors and require cooperation with those requirements.\n...\nThe Memo includes best practices for agencies acquiring general use enterprise-wide generative AI, including contractual requirements for vendors to provide transparency about generated content, protect against inappropriate use, prevent harmful and illegal output, provide evaluation and testing documentation, and mitigate environmental impacts.\n...\nThe Memo calls on agencies to foster a competitive AI marketplace, including by establishing contractual requirements designed to minimize vendor lock-in; prioritizing interoperability and transparency; and leveraging innovative acquisition practices to secure better contract outcomes.\nAppendix I of the Memo outlines actions agencies should take to promote such innovative practices.\n...\nMemorandum M-24-18 further signals a movement by the government from discussing general principles for AI to creating rules around the government’s procurement and use of AI in contracts.\nContractors should expect to continue to see movement towards regulations and should pay close attention to solicitations that may require reporting requirements around, for example: (a) the proposed use of an AI system; (b) the use of new AI features; (c) the protection of personally identifiable information (PII); (d) the data used to train AI models; (e) data accountability; (f) how the AI system is tested and validated; and (g) how bias will be mitigated.",
        "title": "OMB Releases Guidance to Advance Federal AI Acquisition",
        "url": "https://www.crowell.com/en/insights/client-alerts/omb-releases-guidance-to-advance-federal-ai-acquisition",
        "date": "2024-10-29",
        "last_updated": "2026-05-22"
      },
      {
        "snippet": "",
        "title": "[PDF] Compliance Plan for OMB Memorandum M-24-10 ... - Federal Reserve",
        "url": "https://www.federalreserve.gov/publications/files/compliance-plan-for-omb-memorandum-m-24-10-202409.pdf",
        "date": null,
        "last_updated": "2026-03-28"
      },
      {
        "snippet": "",
        "title": "[PDF] M-24-18 Advancing the Responsible Acquisition of Artificial ...",
        "url": "https://static.carahsoft.com/concrete/files/7817/2986/8466/Guidance_M-24-18_Advancing_the_Responsible_Acquisition_of_Artificial_Intelligence_in_Government.pdf",
        "date": null,
        "last_updated": "2025-10-27"
      },
      {
        "snippet": "",
        "title": "EXECUTIVE OFFICE OF THE PRESIDENT",
        "url": "https://whitehouse.gov/wp-content/uploads/2024/10/M-24-18-AI-Acquisition-Memorandum.pdf",
        "date": null,
        "last_updated": "2025-09-14"
      },
      {
        "snippet": "",
        "title": "OFFICE OF MANAGEMENT AND BUDGET - The White House",
        "url": "https://www.whitehouse.gov/wp-content/uploads/2024/10/M-24-18-AI-Acquisition-Memorandum.pdf?trk=public_post_comment-text",
        "date": null,
        "last_updated": "2025-10-24"
      },
      {
        "snippet": "",
        "title": "March 28, 2024 M-24-10 MEMORANDUM FOR THE ...",
        "url": "https://bidenwhitehouse.archives.gov/wp-content/uploads/2024/03/M-24-10-Advancing-Governance-Innovation-and-Risk-Management-for-Agency-Use-of-Artificial-Intelligence.pdf",
        "date": null,
        "last_updated": "2025-10-18"
      },
      {
        "snippet": "*New guidance helps agencies harness the power of AI through their acquisitions process to promote innovation and competition while managing risks*\nToday, the Office of Management and Budget (OMB) released the\n*Advancing the Responsible Acquisition of Artificial Intelligence in Government *memorandum (M-24-18).\nSuccessful use of commercially-provided AI requires responsible procurement of AI.\nThis new memo ensures that when Federal agencies acquire AI, they appropriately manage risks and performance; promote a competitive marketplace; and implement structures to govern and manage their business processes related to acquiring AI.\n...\nThe EO directed sweeping action to strengthen AI safety and security, protect Americans’ privacy, advance equity and civil rights, stand up for consumers and workers, promote innovation and competition, and advance American leadership around the world.\n...\nOMB M-24-10, issued in March 2024, made history by introducing the first government-wide binding requirements for agencies to strengthen governance, innovation, and risk management for use of AI.\nM-24-18 builds on this guidance to help agencies buy AI responsibly.\nAgency acquisition of AI is similar in many respects to the purchase of other types of information technology, but it also presents novel challenges.\nM-24-18 helps agencies anticipate and address these challenges by issuing requirements and providing recommendations around three strategic goals.\n**Managing AI Risks and Performance**\nThe complex nature of how AI systems are built, trained, and deployed creates certain considerations and challenges for agency acquisition of AI.\nFor this reason, M-24-18 includes best practices and specific requirements for managing AI risk and performance, with additional requirements for acquiring AI use cases associated with rights-impacting and safety-impacting AI.\nThe memorandum:\n- Requires that agency privacy officials and programs have early, ongoing involvement in AI acquisition processes so that they are able to identify and manage privacy risks and ensure compliance with law and policy;\n- Calls for agencies to work with vendors to understand when AI is being acquired and when such acquisition triggers additional risk management requirements for rights-impacting and safety-impacting AI;\n- Promotes the use of innovative outcomes-based acquisition techniques that strengthen agencies’ ability to effectively plan for, manage, and continuously mitigate risk as well as drive performance;\n- Instructs agencies to negotiate appropriate contractual requirements and evaluation processes to ensure vendors provide sufficient information for agencies to evaluate vendor claims, identify and manage risk, conduct impact assessments, and fulfill requirements to notify impacted individuals and implement appeals; and\n- Directs contractual terms to be negotiated in a way that protects government data and intellectual property, and be defined in a manner that ensures safe use when AI is involved in decision-making that impacts members of the public.\n**Promoting a Competitive AI Market with Innovative Acquisition**\nAs AI evolves, agencies must have access to the best available solutions from a diverse and evolving market of suppliers.\nM-24-18 calls on agencies to ensure robust competition – both to increase value for the Federal government, and reduce risks to rights and safety, including by:\n- Proactively incorporating acquisition principles designed to minimize vendor lock-in when establishing contractual requirements;\n- Explicitly considering interoperability and transparency during market research, requirements development, and vendor evaluation processes; and\n- Leveraging innovative acquisitions practices to secure good contractor performance and mission outcomes.\n**Ensuring Collaboration Across the Federal Government**\nManaging novel risks and the rapidly evolving AI technology landscape requires agencies to establish cross-functional teams that include officials with AI expertise and personnel from other relevant fields—including acquisition, cybersecurity, privacy, and civil liberties—to inform strategic planning and acquisition of AI.\nThrough interagency councils and other efforts, agencies will work together to share lessons learned to inform future policy and procedural efforts to support effective and responsible acquisition of AI.\nThese collaborations should include considerations for:\n- Identifying and prioritizing AI investments that best serve an agency’s mission;\n- Developing the capacity to deploy any acquired AI; and\n- Promoting adoption of cross-functional best practices for the duration of use.",
        "title": "FACT SHEET: OMB Issues Guidance to Advance the Responsible Acquisition of AI in Government | OMB | The White House",
        "url": "https://www.whitehouse.gov/omb/briefing-room/2024/10/03/fact-sheet-omb-issues-guidance-to-advance-the-responsible-acquisition-of-ai-in-government/",
        "date": "2024-10-03",
        "last_updated": "2024-10-03"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

### Number of Results

Set `max_results` to control how many results the tool collects per `web_search` call. It's the total for the call; with several reformulated queries the budget is split per query (roughly `ceil(max_results / number_of_queries)`). When omitted, the default budget applies.

<CodeGroup>
  ```python Python theme={null}
  tools = [
      {
          "type": "web_search",
          "search_context_size": "low",
          "max_results": 20
      }
  ]
  ```

  ```typescript Typescript theme={null}
  const tools = [
    {
      type: 'web_search' as const,
      search_context_size: 'low',
      max_results: 20,
    },
  ];
  ```

  ```bash cURL theme={null}
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "low",
      "max_results": 20
    }
  ]
  ```
</CodeGroup>

<Note>
  `max_results` accepts the range documented in the [API reference](/api-reference/agent-post). Within range, the backend may return fewer results than requested. Use it together with `search_context_size` to trade breadth (number of results) against depth (content extracted per result).
</Note>

## Filters

Use filters to constrain the sources, dates, and location context used by `web_search`.

| Filter | Type | Description |
| - | - | - |
| `search_domain_filter` | array of strings | Include or exclude up to 20 domains or URLs. Prefix entries with `-` to exclude them. |
| `search_recency_filter` | string | Restrict results to `"hour"`, `"day"`, `"week"`, `"month"`, or `"year"`. |
| `search_after_date_filter` | string | Include results published after a date in MM/DD/YYYY format. |
| `search_before_date_filter` | string | Include results published before a date in MM/DD/YYYY format. |
| `last_updated_after_filter` | string | Include results last updated after a date in MM/DD/YYYY format. |
| `last_updated_before_filter` | string | Include results last updated before a date in MM/DD/YYYY format. |
| `user_location` | object | Personalize search by country, region, city, latitude, and longitude. |

### Domain filter

<Warning>
  Use `search_domain_filter` in either allowlist mode or denylist mode, not both. The domain filter accepts up to 20 domains or URLs. For example, `["nasa.gov", "wikipedia.org"]` includes only those domains, while `["-reddit.com", "-pinterest.com"]` excludes those domains.
</Warning>

Entries can be at the domain level (e.g., `wikipedia.org`) or at the URL level (e.g., `https://en.wikipedia.org/wiki/Chess`) for more granular control.

### Recency filter

`search_recency_filter` maps each value to a relative window:

| Value | Window |
| - | - |
| `hour` | Past hour — use for real-time data such as breaking news or live events |
| `day` | Past 24 hours |
| `week` | Past 7 days |
| `month` | Past 30 days |
| `year` | Past 365 days |

For exact ranges, use `search_after_date_filter` / `search_before_date_filter` (publication date) or `last_updated_after_filter` / `last_updated_before_filter` (last update). Date filter values must use the `MM/DD/YYYY` format (e.g., `"03/01/2026"`).

### Location filter

`user_location` accepts any combination of the following fields:

* `country` — Two-letter [ISO 3166-1 alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) code (for example, `"US"`, `"FR"`).
* `region` — Region or state name (for example, `"California"`).
* `city` — City name (for example, `"San Francisco"`).
* `latitude` and `longitude` — Coordinates for precise targeting.

<Tip>
  `city` and `region` significantly improve location accuracy. Include them alongside `country` whenever possible.
</Tip>

<Warning>
  `latitude` and `longitude` must be provided together with `country`. They cannot be supplied on their own.
</Warning>

### Filter Usage Cheatsheet

Copy any of these snippets into a `web_search` tool object. `user_location` sits alongside `filters`, while the other controls sit inside `filters`.

| Filter | Example |
| - | - |
| Domain allowlist | `filters: { search_domain_filter: ["docs.perplexity.ai", "developer.mozilla.org"] }` |
| Domain denylist | `filters: { search_domain_filter: ["-reddit.com", "-pinterest.com"] }` |
| Recency | `filters: { search_recency_filter: "week" }` |
| Published date range | `filters: { search_after_date_filter: "01/01/2026", search_before_date_filter: "05/01/2026" }` |
| Last updated range | `filters: { last_updated_after_filter: "01/01/2026", last_updated_before_filter: "05/01/2026" }` |
| User location | `user_location: { country: "US", region: "CA", city: "San Francisco", latitude: 37.7749, longitude: -122.4194 }` |

<Tip>
  Filters compose freely. Combine any of the source, date, recency, and location filters above in a single `web_search` tool object — there's no per-request limit on filter combinations.
</Tip>

<CodeGroup>
  ```python Python theme={null}
  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="What were the binding obligations of President Biden's 2023 Executive Order 14110 on AI?",
      tools=[
          {
              "type": "web_search",
              "search_context_size": "medium",
              "filters": {
                  "search_domain_filter": [".gov"],
                  "search_recency_filter": "month"
              },
              "user_location": {
                  "country": "US"
              }
          }
      ],
  )
  ```

  ```typescript Typescript theme={null}
  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'What were the binding obligations of President Biden\'s 2023 Executive Order 14110 on AI?',
    tools: [
      {
        type: 'web_search' as const,
        search_context_size: 'medium',
        filters: {
          search_domain_filter: ['.gov'],
          search_recency_filter: 'month',
        },
        user_location: {
          country: 'US',
        },
      },
    ],
  });
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "What were the binding obligations of President Biden\u0027s 2023 Executive Order 14110 on AI?",
      "tools": [
        {
          "type": "web_search",
          "search_context_size": "medium",
          "filters": {
            "search_domain_filter": [".gov"],
            "search_recency_filter": "month"
          },
          "user_location": {
            "country": "US"
          }
        }
      ]
    }' | jq
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "11c1c78d-b8c8-4442-8563-a79b7faac177",
    "results": [
      {
        "snippet": "**Executive Order 14110**, titled **Executive Order on Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence** (sometimes referred to as \"**Executive Order on Artificial Intelligence**\") was the 126th executive order signed by former U.S. President Joe Biden.\nSigned on October 30, 2023, the order defines the administration's policy goals regarding artificial intelligence (AI), and orders executive agencies to take actions pursuant to these goals.\nThe order is considered to be the most comprehensive piece of governance by the United States regarding AI.\nIt was rescinded by U.S. President Donald Trump within hours of his assuming office on January 20, 2025.\nPolicy goals outlined in the executive order pertain to promoting competition in the AI industry, preventing AI-enabled threats to civil liberties and national security, and ensuring U.S. global competitiveness in the AI field.\nThe executive order required a number of major federal agencies to create dedicated \"chief artificial intelligence officer\" positions within their organizations.\n...\nThe order has been characterized as an effort for the United States to capture potential benefits from AI while mitigating risks associated with AI technologies.\n...\nPolicy goals outlined by the order include the following:\n- Promoting competition and innovation in the AI industry\n- Upholding civil and labor rights and protecting consumers and their privacy from AI-enabled harms\n- Specifying federal policies governing procurement and use of AI\n- Developing watermarking systems for AI-generated content and warding off intellectual property theft stemming from the use of generative models\n- Maintaining the nation's place as a global leader in AI\n## Impact on agencies\n...\nThe executive order required a number of large federal agencies to appoint a chief artificial intelligence officer, with a number of departments having already appointed a relevant officer prior to the order.\n...\nUnder the executive order, the Department of Homeland Security (DHS) was responsible for developing AI-related security guidelines, including cybersecurity-related matters.\nThe DHS will also work with private sector firms in sectors including the energy industry and other \"critical infrastructure\" to coordinate responses to AI-enabled security threats.\nExecutive Order 14110 mandated the Department of Veterans Affairs to launch an AI technology competition aimed at reducing occupational burnout among healthcare workers through AI-assisted tools for routine tasks.\nThe order also mandated the Department of Commerce's National Institute of Standards and Technology (NIST) to develop a generative artificial intelligence-focused resource to supplement the existing AI Risk Management Framework.\n...\nThe executive order has been described as the most comprehensive piece of governance by the United States government pertaining to AI.\nEarlier in 2023 prior to the signing of the order, the Biden administration had announced a Blueprint for an AI Bill of Rights, and had secured non-binding AI safety commitments from major tech companies.\n...\nAccording to *Axios*, despite the wide scope of the executive order, it notably does not touch upon a number of AI-related policy proposals.\nThis includes proposals for a \"licensing regime\" to government advanced AI models, which has received support from industry leaders including Sam Altman.\nAdditionally, the executive order does not seek to prohibit 'high-risk' uses of AI technology, and does not aim to mandate that tech companies release information surrounding AI systems' training data and models.",
        "title": "Executive Order 14110 - Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Executive_Order_14110",
        "date": "2023-11-13",
        "last_updated": "2026-03-21"
      },
      {
        "snippet": "",
        "title": "657",
        "url": "https://www.govinfo.gov/content/pkg/CFR-2024-title3-vol1/pdf/CFR-2024-title3-vol1-eo14110.pdf",
        "date": null,
        "last_updated": "2025-01-28"
      },
      {
        "snippet": "",
        "title": "Federal Register, Volume 88 Issue 210 (Wednesday, November 1 ...",
        "url": "https://www.govinfo.gov/content/pkg/FR-2023-11-01/html/2023-24283.htm",
        "date": null,
        "last_updated": "2026-03-08"
      },
      {
        "snippet": "",
        "title": "1",
        "url": "https://www.govinfo.gov/content/pkg/DCPD-202300949/pdf/DCPD-202300949.pdf",
        "date": null,
        "last_updated": "2025-01-16"
      },
      {
        "snippet": "",
        "title": "Presidential Documents",
        "url": "https://upload.wikimedia.org/wikipedia/commons/e/ef/Executive_Order_14110.pdf",
        "date": null,
        "last_updated": "2025-12-17"
      },
      {
        "snippet": "",
        "title": "Executive Order 14110 - Wikisource, the free online library",
        "url": "https://en.wikisource.org/wiki/Executive_Order_14110",
        "date": "2023-11-13",
        "last_updated": "2025-03-10"
      },
      {
        "snippet": "Today, President Biden is issuing a landmark Executive Order to ensure that America leads the way in seizing the promise and managing the risks of artificial intelligence (AI).\nThe Executive Order establishes new standards for AI safety and security, protects Americans’ privacy, advances equity and civil rights, stands up for consumers and workers, promotes innovation and competition, advances American leadership around the world, and more.\n...\nThe Executive Order directs the following actions:**New Standards for AI Safety and Security**\nAs AI’s capabilities grow, so do its implications for Americans’ safety and security.\n**With this Executive Order, the** ** President directs the ** **most sweeping ** **actions ** **ever taken ** **to protect Americans from ** **the potential ** **risks ** **of ** **AI** ** systems** **:**\n- **Require that developers of the most powerful AI systems share their safety test results and other critical information with the U.S. government.** In accordance with the Defense Production Act, the Order will require that companies developing any foundation model that poses a serious risk to national security, national economic security, or national public health and safety must notify the federal government when training the model, and must share the results of all red-team safety tests.\nThese measures will ensure AI systems are safe, secure, and trustworthy before companies make them public.\n- **Develop standards, tools, and tests to help ensure that AI systems are safe, secure, and trustworthy.** The National Institute of Standards and Technology will set the rigorous standards for extensive red-team testing to ensure safety before public release.\nThe Department of Homeland Security will apply those standards to critical infrastructure sectors and establish the AI Safety and Security Board.\nThe Departments of Energy and Homeland Security will also address AI systems’ threats to critical infrastructure, as well as chemical, biological, radiological, nuclear, and cybersecurity risks.\nTogether, these are the most significant actions ever taken by any government to advance the field of AI safety.\n- **Protect against the risks of using AI to engineer dangerous biological materials** by developing strong new standards for biological synthesis screening.\nAgencies that fund life-science projects will establish these standards as a condition of federal funding, creating powerful incentives to ensure appropriate screening and manage risks potentially made worse by AI.\n- **Protect Americans from AI-enabled fraud and deception by establishing standards and best practices for detecting AI-generated content and authenticating official content**.\nThe Department of Commerce will develop guidance for content authentication and watermarking to clearly label AI-generated content.\nFederal agencies will use these tools to make it easy for Americans to know that the communications they receive from their government are authentic—and set an example for the private sector and governments around the world.\n- **Establish an advanced cybersecurity program to develop AI tools to find and fix vulnerabilities in critical software,** building on the Biden-Harris Administration’s ongoing AI Cyber Challenge.\nTogether, these efforts will harness AI’s potentially game-changing cyber capabilities to make software and networks more secure.\n- **Order the development of a National Security Memorandum that directs further actions on AI and security,** to be developed by the National Security Council and White House Chief of Staff.\nThis document will ensure that the United States military and intelligence community use AI safely, ethically, and effectively in their missions, and will direct actions to counter adversaries’ military use of AI.\n...\n**To better protect Americans’ privacy, including from the risks posed by AI, the President calls on Congress to pass bipartisan data privacy legislation to protect all Americans, especially kids, and directs the following actions:**\n- **Protect Americans’ privacy by prioritizing federal support for accelerating the development and use of privacy-preserving techniques—** including ones that use cutting-edge AI and that let AI systems be trained while preserving the privacy of the training data.\n- **Strengthen privacy-preserving research** **and technologies,** such as cryptographic tools that preserve individuals’ privacy, by funding a Research Coordination Network to advance rapid breakthroughs and development.\nThe National Science Foundation will also work with this network to promote the adoption of leading-edge privacy-preserving technologies by federal agencies.\n- **Evaluate how agencies collect and use commercially available information**—including information they procure from data brokers—and**strengthen privacy guidance for federal agencies** to account for AI risks.\nThis work will focus in particular on commercially available information containing personally identifiable data.\n- **Develop guidelines for federal agencies to evaluate the effectiveness of privacy-preserving techniques,** including those used in AI systems.\nThese guidelines will advance agency efforts to protect Americans’ data.\n**Advancing Equity and Civil Rights**\nIrresponsible uses of AI can lead to and deepen discrimination, bias, and other abuses in justice, healthcare, and housing.\nThe Biden-Harris Administration has already taken action by publishing the Blueprint for an AI Bill of Rights and issuing an Executive Order directing agencies to combat algorithmic discrimination, while enforcing existing authorities to protect people’s rights and safety.\n**To ensure that AI advances equity and civil rights, the President directs the following additional actions:**\n- **Provide clear guidance to landlords, Federal benefits programs, and federal contractors** to keep AI algorithms from being used to exacerbate discrimination.\n- **Address algorithmic discrimination** through training, technical assistance, and coordination between the Department of Justice and Federal civil rights offices on best practices for investigating and prosecuting civil rights violations related to AI.\n- **Ensure fairness throughout the criminal justice system** by developing best practices on the use of AI in sentencing, parole and probation, pretrial release and detention, risk assessments, surveillance, crime forecasting and predictive policing, and forensic analysis.\n...\n**To protect consumers while ensuring that AI can make Americans better off, the President directs the following actions:**\n- **Advance the responsible use of AI** in healthcare and the development of affordable and life-saving drugs.\nThe Department of Health and Human Services will also establish a safety program to receive reports of—and act to remedy – harms or unsafe healthcare practices involving AI.\n- **Shape AI’s potential to transform education** by creating resources to support educators deploying AI-enabled educational tools, such as personalized tutoring in schools.\n**Supporting Workers**\nAI is changing America’s jobs and workplaces, offering both the promise of improved productivity but also the dangers of increased workplace surveillance, bias, and job displacement.\n**To mitigate these risks, support workers’ ability to bargain collectively, and invest in workforce training and development that is accessible to all, the President directs the following actions:**\n- **Develop principles and best practices to mitigate the harms and maximize the benefits of AI for workers** by addressing job displacement; labor standards; workplace equity, health, and safety; and data collection.\nThese principles and best practices will benefit workers by providing guidance to prevent employers from undercompensating workers, evaluating job applications unfairly, or impinging on workers’ ability to organize.\n- **Produce a report on AI’s potential labor-market impacts**, and**study and identify options for strengthening federal support for workers facing labor disruptions**, including from AI.\n**Promoting Innovation and Competition**\n...\n**The Executive Order ensures that we continue to lead the way in innovation and competition through the following actions:**\n- **Catalyze AI research across the United States** through a pilot of the National AI Research Resource—a tool that will provide AI researchers and students access to key AI resources and data—and expanded grants for AI research in vital areas like healthcare and climate change.\n- **Promote a fair, open, and competitive AI ecosystem** by providing small developers and entrepreneurs access to technical assistance and resources, helping small businesses commercialize AI breakthroughs, and encouraging the Federal Trade Commission to exercise its authorities.\n- **Use existing authorities to expand the ability of highly skilled immigrants and nonimmigrants with expertise in critical areas to study, stay, and work in the United States** by modernizing and streamlining visa criteria, interviews, and reviews.\n...\nAI’s challenges and opportunities are global.\n**The Biden-Harris Administration will continue working with other nations to support safe, secure, and trustworthy deployment and use of AI worldwide.\nTo that end, the President directs the following actions:**\n- **Expand bilateral, multilateral, and multistakeholder engagements to collaborate on AI**.\nThe State Department, in collaboration, with the Commerce Department will lead an effort to establish robust international frameworks for harnessing AI’s benefits and managing its risks and ensuring safety.\nIn addition, this week, Vice President Harris will speak at the UK Summit on AI Safety, hosted by Prime Minister Rishi Sunak.\n- **Accelerate development and implementation of vital AI standards** with international partners and in standards organizations, ensuring that the technology is safe, secure, trustworthy, and interoperable.\n- **Promote the safe, responsible, and rights-affirming development and deployment of AI abroad to solve global challenges,** such as advancing sustainable development and mitigating dangers to critical infrastructure.\n**Ensuring Responsible and Effective Government Use of AI**\nAI can help government deliver better results for the American people.\nIt can expand agencies’ capacity to regulate, govern, and disburse benefits, and it can cut costs and enhance the security of government systems.\nHowever, use of AI can pose risks, such as discrimination and unsafe decisions.\n**To ensure the responsible government deployment of AI and modernize federal AI infrastructure, the President directs the following actions:**\n- **Issue guidance for agencies’ use of AI,** including clear standards to protect rights and safety, improve AI procurement, and strengthen AI deployment.\n- **Help agencies acquire specified AI products and services** faster, more cheaply, and more effectively through more rapid and efficient contracting.\n- **Accelerate the rapid hiring of AI professionals** as part of a government-wide AI talent surge led by the Office of Personnel Management, U.S. Digital Service, U.S. Digital Corps, and Presidential Innovation Fellowship.\nAgencies will provide AI training for employees at all levels in relevant fields.",
        "title": "FACT SHEET: President Biden Issues Executive Order on Safe, Secure, and Trustworthy Artificial Intelligence | The White House",
        "url": "https://web.archive.org/web/20250101021400/https:/www.whitehouse.gov/briefing-room/statements-releases/2023/10/30/fact-sheet-president-biden-issues-executive-order-on-safe-secure-and-trustworthy-artificial-intelligence/",
        "date": "2023-10-30",
        "last_updated": "2026-02-27"
      },
      {
        "snippet": "",
        "title": "Executive Order on the Safe, Secure, and Trustworthy Development ...",
        "url": "https://bidenwhitehouse.archives.gov/briefing-room/presidential-actions/2023/10/30/executive-order-on-the-safe-secure-and-trustworthy-development-and-use-of-artificial-intelligence/",
        "date": "2023-10-30",
        "last_updated": "2025-12-25"
      },
      {
        "snippet": "On October 30, 2023, United States President Joseph Biden signed Executive Order 14110 on the \"Safe, Secure, and Trustworthy Development and Use of Artificial Intelligence.\"^1^ The Order is the culmination of ongoing efforts by the Biden Administration to articulate its policies and priorities on AI.^2^ Sweeping in scope and addressing agencies across industries and sectors, the Order is premised on the understanding that \"[h]arnessing AI for good and realizing its myriad benefits requires mitigating its substantial risks.\"^3^\nWhile the Order applies primarily and most immediately to federal agencies, it includes an important provision for foundation model developers and more generally illustrates the Biden Administration's vision for how it intends to pursue AI development and regulation while federal legislation remains forthcoming.\n...\nSection 4 includes some of the Order's most novel and notable requirements, setting out detailed directives for the development of new standards, tools, testing protocols, and best practices for AI safety and security.\n- **Mandating the development of federal standards:** Section 4.1 provides that, within 270 days of the date of the Order (i.e., July 26, 2024), the National Institute of Standards and Technology (\"**NIST**\") shall establish guidelines and best practices, including setting standards for \"red-team testing,\" defined in Section 3 to mean structured testing efforts, often through adversarial methods, to identify flaws and vulnerabilities associated with the misuse of the AI system.\n-\n**Requiring developers of the most powerful AI systems to share safety tests results and other critical information with the U.S. government: ** Section 4.2 outlines reporting requirements for AI model owners and large data centers.\nThe Order directs the Secretary of Commerce, within 90 days of the date of the Order (i.e., January 28, 2024), to require \"companies developing or demonstrating an intent to develop potential dual-use foundation models\" (defined in Sec.\n3) to provide detailed information about their activities and models to the federal government on an ongoing basis.\nThis includes the results of any developed dual-use foundation model's performance in relevant AI red-team testing based on the guidance developed by NIST.^4^ By applying to \"companies developing or demonstrating an intent to develop\" such models, the Order seems to contemplate that information subject to the reporting requirements must be shared with the federal government before the relevant AI systems are made available to the public.\nWithin the same 90 days, the Secretary of Commerce is also directed to require companies to report their acquisition, development, or possession of large-scale computing clusters, including the existence and location of such clusters and the total amount of computing power available in each.^5^ Section 4.2(b) sets forth interim criteria to identify the minimum threshold for foundation models and computing clusters that would be subject to the reporting requirements.\n^6^ While Section 4.2 explicitly invokes the authority under the Defense Production Act, a law traditionally used during times of war or national emergencies such as the COVID-19 pandemic, it does not cite a specific provision.\n- **Developing methods to detect and denote AI-generated content: ** Section 4.5 articulates requirements for reducing the risks posed by \"synthetic\" – i.e., AI-generated – content.\nThe Order requires the Department of Commerce to develop guidance for content authentication and watermarking to clearly label AI-generated content.\nThe fact sheet on the Executive Order released by the White House specifies, \"Federal agencies will use these tools to make it easy for Americans to know that the communications they receive from their government are authentic—and set an example for the private sector and governments around the world.\"^7^\n...\nThe organizing principle of the Order is the Biden Administration's desire to balance the unique risks of AI against the novel benefits.\nWhile privacy is a recurring theme throughout the Order, Section 9 is dedicated to privacy and includes specific directives to strengthen privacy-protecting technologies.\nFor example, the Director of the Office of Management and Budget is directed to evaluate commercially available information (\"**CAI**\") procured by agencies, including CAI procured from data brokers and CAI procured and processed indirectly through vendors, with a particular emphasis on CAI that contains personally identifiable information.\n...\nDedicated to civil rights, Section 7 includes detailed directives to government agencies to address and prevent unlawful discrimination and other harms that may be exacerbated by AI in the criminal justice system, the administration of government benefits and programs, and other areas such as hiring and housing.\nSection 8 lays out additional protections for consumers, patients, passengers, and students.\nThe Order also devotes lengthy sections to the efforts the federal government must undertake to position the United States as a global leader in AI, including calls to catalyze AI research across the United States (see Sec.\n5.2) and encouraging the FTC to exercise its authorities to help small businesses commercialize AI breakthroughs (see Sec.\n5.3).\nWhile the Order includes directives to expand the recruitment efforts of \"AI talent,\" including highly skilled immigrants by updating and streamlining visa criteria and processing (see Sec.\n5.1), the Order also calls out the need to mitigate the harms of AI for workers (see Sec. 6).\nSection 11 directs the Secretary of State to expand engagement with international allies to advance global technical standards for AI development, among other initiatives.\n...\nVarious provisions within the Order provide that its directives must be implemented over the range of 90 days to one year, making clear the Government's priority that AI governance be treated with urgency.\nWhile federal legislation remains elusive, federal agencies implementing the Order may begin shaping AI regulation in the meantime.\n...\nThe Order articulates the following key principles and priorities: (1) AI must be safe and secure; (2) To lead in AI, the U.S. must promote responsible innovation, competition, and collaboration; (3) Responsible development and use of AI require a commitment to supporting American workers; (4) AI policies must advance equity and civil rights;",
        "title": "Biden Executive Order seeks to govern the “promise and peril” of AI",
        "url": "https://www.whitecase.com/insight-our-thinking/biden-executive-order-seeks-govern-promise-and-peril-ai",
        "date": "2023-11-03",
        "last_updated": "2026-03-21"
      },
      {
        "snippet": "",
        "title": "Key Provisions and Impacts of Biden's Executive Order on AI…",
        "url": "https://www.fenwick.com/insights/publications/key-provisions-and-impacts-of-bidens-executive-order-on-ai-regulation-and-development",
        "date": "2023-11-09",
        "last_updated": "2026-03-04"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

## Parameters

| Parameter | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"web_search"`. |
| `search_type` | string | No | `"web"` or `"fast"`. Inherits the preset's value when configured; otherwise defaults to `"web"`. See [Search Type](#search-type). |
| `search_context_size` | string | No | Recommended token budget: `"low"`, `"medium"`, or `"high"`. See [Using Recommended Token Budgets](#using-recommended-token-budgets). |
| `filters` | object | No | Domain, date, recency, and location filters. See [Filters](#filters). |
| `user_location` | object | No | Location context for search personalization. |
| `max_results` | integer | No | Upper bound on results collected per call (1-50). See [Number of Results](#number-of-results). |
| `max_tokens` | integer | No | Maximum total tokens for search context. |
| `max_tokens_per_page` | integer | No | Maximum tokens extracted from each search result page. |

## Response Shape

When `web_search` runs, the response can include a `search_results` output item before the final assistant message. The final `usage` object includes token counts, cost details, and `tool_calls_details.search_web.invocation` when tool-call usage is reported.

```json theme={null}
{
  "output": [
    {
      "type": "search_results",
      "queries": ["AI infrastructure announcements"],
      "results": [
        {
          "id": 1,
          "url": "https://example.com/news",
          "title": "Example AI infrastructure announcement",
          "snippet": "A short snippet from the search result.",
          "date": "2026-05-01",
          "last_updated": "2026-05-01",
          "source": "web"
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "The answer generated from the search results."
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 1200,
    "output_tokens": 300,
    "total_tokens": 1500,
    "tool_calls_details": {
      "search_web": {
        "invocation": 1
      }
    }
  }
}
```

Each entry in `results` includes the following fields:

| Field | Type | Description |
| - | - | - |
| `id` | integer | Stable index used to reference the result in citations. |
| `url` | string | Canonical URL of the source page. |
| `title` | string | Page title as returned by the source. |
| `snippet` | string | Excerpted text extracted from the page during search. |
| `date` | string | Date the page was originally published, in `YYYY-MM-DD` format. |
| `last_updated` | string | Date the page was last updated, in `YYYY-MM-DD` format. |
| `source` | string | Origin of the result (for example, `"web"`). |

<Tip>
  **Want inline citations?** Whether the model adds markers to the answer is prompt-dependent, so ask for them explicitly - for example, append to your prompt: *"Cite your sources inline using bracketed markers, one source per bracket, like `[1][2]`."* Each number then refers to a result's `id`. Regardless of markers, treat the `id` and `url` fields of each `search_results` entry as the source of truth for citations.
</Tip>

## Pricing

`web_search` is billed at **$2.50 per 1,000 invocations**, or **$1.00 per 1,000 invocations** with `search_type: "fast"`. Fast calls are still reported under `tool_calls_details.search_web`. Model token usage is billed separately according to Agent API token pricing.

<Note>
  Pricing follows the same pattern as other tool calls: pay for tool invocations plus model tokens. See [Pricing](/docs/getting-started/pricing).
</Note>

## Limits / Quotas

`web_search` runs inside Agent API requests and is governed by Agent API request rate limits. See [Rate Limits & Usage Tiers](/docs/admin/rate-limits-usage-tiers#agent-api-rate-limits) for the current tier-based Agent API limits.

| Limit | Applies to | Guidance |
| - | - | - |
| Rate limits | Agent API requests that include `web_search` | Agent API tier limits apply to the request. Add retry and backoff handling for production traffic. |
| Domain entries | `search_domain_filter` | Up to 20 domains or URLs per request. Use either allowlist or denylist mode as described in the [Filters](#filters) warning. |
| Search context budget | `search_context_size`, `max_tokens`, `max_tokens_per_page` | `search_context_size` presets manage context automatically. Use explicit token caps when you need tighter cost or latency controls. |
| Tool-call billing | `web_search` invocations | Each search invocation counts toward tool-call usage and pricing, separate from model token usage. |

## Next Steps

<CardGroup cols={2}>
  <Card title="Fetch URL Content" icon="file-text" href="/docs/agent-api/tools/fetch-url-content">
    Fetch full content from known URLs.
  </Card>

  <Card title="People Search" icon="users" href="/docs/agent-api/tools/people-search">
    Search for professionals, employees, and people.
  </Card>

  <Card title="Agent API Presets" icon="settings" href="/docs/agent-api/presets">
    Use optimized presets for common Agent API workloads.
  </Card>

  <Card title="API Reference" icon="code-circle" href="/api-reference/agent-post">
    View complete endpoint documentation.
  </Card>
</CardGroup>
