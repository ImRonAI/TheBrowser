> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Fetch URL Content

> Fetch and extract content from specific URLs in the Agent API.

## Overview

The `fetch_url` tool fetches and extracts content from specific URLs during an Agent API request. Use it when your application already knows which page, article, document, or report the model should inspect.

Use `fetch_url` when you need full page content from known URLs. Use [`web_search`](/docs/agent-api/tools/web-search) when the model first needs to discover relevant pages.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()

  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      input="Explain Bayesian inference: how prior beliefs are updated to posterior beliefs given new evidence, with a concrete medical-test example.",
      tools=[
          {
              "type": "fetch_url"
          }
      ],
      instructions="Fetch the URL before summarizing it.",
  )

  print(response.output_text)
  ```

  ```typescript Typescript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    input: 'Explain Bayesian inference: how prior beliefs are updated to posterior beliefs given new evidence, with a concrete medical-test example.',
    tools: [
      {
        type: 'fetch_url' as const,
      },
    ],
    instructions: 'Fetch the URL before summarizing it.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl https://api.perplexity.ai/v1/agent \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "input": "Explain Bayesian inference: how prior beliefs are updated to posterior beliefs given new evidence, with a concrete medical-test example.",
      "tools": [
        {
          "type": "fetch_url"
        }
      ],
      "instructions": "Fetch the URL before summarizing it."
    }' | jq
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "resp_02fda963-4ab7-42cc-b446-d446e0dcd3b2",
    "created_at": 1779391738,
    "model": "openai/gpt-5.6-sol",
    "object": "response",
    "output": [
      {
        "results": [
          {
            "id": 1,
            "snippet": "The disease you have tested positive for is very rare, so let’s say that only 1 in every 100 people with your symptoms actually have the disease.\nThe test you took is 99% sensitive, and 94% specific.\nAccording to Bayes’ Theorem, these numbers mean that if you test positive, there is in fact only a 14% chance you actually have the disease… but how is that possible?",
            "title": "Bayes' Theorem and Disease Testing - tom rocks maths",
            "url": "https://tomrocksmaths.com/2021/08/31/bayes-theorem-and-disease-testing/",
            "date": "2021-08-31",
            "last_updated": "2026-05-13",
            "source": "web"
          },
          {
            "id": 2,
            "snippet": "- Suppose that 5 in 1,000 people (0.5%) has a particular disease\n(*prevalence* of the disease).\n- A diagnostic test for the disease has 99% *sensitivity* (if a person has the disease, the test will give a positive result with a probability of 0.99).\n- The test has 98% *specificity* (if a person does not have the disease, the test will give a negative result with a probability of 0.98).\nWe ask:\n- What is the probability that a person has the disease\nafter he was tested positive.\n- What is the probability that a person does not have the disease\nafter she was tested negative.\n...\nThe sensitivity and specificity give the conditional probabilities: $$\\begin{align} P(+ | D) & = 0.99 = sens \\\\ P(- | D) & = 0.01 \\\\ P(+ | \\overline{D}) & = 0.02 \\\\ P(- | \\overline{D}) & = 0.98 = spec \\end{align}$$ The posterior probabilities are given by Bayes formula.\nPositive prediction: $$\\begin{align} P(D | +) & = \\frac{P(+ | D) P(D)} {P(+ | D) P(D) + P(+ | \\overline{D}) P(\\overline{D}) } \\\\ & = \\frac{sens \\times preval} {sens \\times preval + (1- spec) \\times (1 - preval) } \\\\ & = \\frac{0.99 \\times 0.005} {0.99 \\times 0.0005 + 0.02 \\times 0.995} = 0.20 \\end{align}$$ and negative prediction: $$\\begin{align} P(\\overline{D} | -) & = \\frac{P(- | \\overline{D}) P(\\overline{D})} {P(- | D) P(D) + P(- | \\overline{D}) P(\\overline{D}) } \\\\ & = \\frac{spec * (1 - preval)} {spec \\times (1 - preval) + (1 - sens) \\times preval} \\\\ & = \\frac{0.98 \\times 0.995} {0.98 \\times 0.9995 + 0.01 \\times 0.005} = 1.0 \\end{align}",
            "title": "Sensitivity and Specificity",
            "url": "https://www.nosco.ch/mathematics/en/sensitivity-specificity.php",
            "date": null,
            "last_updated": "2026-05-17",
            "source": "web"
          },
          {
            "id": 3,
            "snippet": "Suppose a blood test used to\ndetect the presence of a particular banned sports drug is **99%\n** **sensitive** and **99% ** **specific**.\nThat is, the test will produce 99% **true positive** results for drug users and 99% **true negative** results for non-drug users.\nSuppose that **0.5%** of athletes are users of the drug.\nWhat is the *likelihood * that *a randomly\nselected athlete who **tests positive is a user** *?",
            "title": "Bayes Theorem - Drug testing",
            "url": "https://www.mun.ca/biology/scarr/4250_Bayes_Theorem.html",
            "date": null,
            "last_updated": "2026-03-14",
            "source": "web"
          },
          {
            "id": 4,
            "snippet": "A: mammogram positive, B: developing breast cancer in next 2 years\nSuppose that 7% of the general population of women will have a positive mammogram.\nWhat is the probability of developing breast cancer over the next 2 years among women\nin the general population?\nP(breast cancer | mammogram+) = .1\nP(breast cancer | mammogram-) = .0002\nP(B) = P(breast cancer)\n= P(breast cancer | mammogram+)P(mammogram+) + P(breast cancer | mammogram-\n)P(mammogram-) = .1(.07) + .0002(.93) = 0.00719\nPV+ = P(breast cancer|mammogram+) = .1\nPV- = P(no breast cancer | mammogram-) = 1- P(breast cancer | mammogram-) = 1-.0002\n= .9998\n...\nBayes’ Rule\nLet A = symptom and B = disease.\nThen\nPV + = P(B | A) =\nP(A | B)P(B)\nP(A | B)P(B) + P(A | Bc)P(Bc)\nThis can be written as\n1\nPV + =\nsensitivity × x\nsensitivity × x + (1 −specificity) × (1 −x)\nwhere x = P(B) = probability of disease in the reference population.\nExample: (Cancer) Suppose the disease is lung cancer and the symptom is cigarette smok-\ning.\nIf we assume 90% of people with lung cancer and 30 % of people without lung cancer\nare smokers, What is the sensitivity and specificity?\nSymptom: smoking, Disease: lung\ncancer\nSensitivity = P(symptom | disease) = .9\nSpecificity = P(no symptom | no disease) = 1- P(symptom | no disease) = .7\nExample: (Hypertension) Suppose 84% of hypertensive and 23% of normotensives are clas-\nsified as hypertensive by an automated blood-pressure machine.\nWhat are the predictive\nvalue positive and predictive value negative of the machine, assuming 20% of the adult\npopulation is hypertensive?\nThe sensitivity = P(symptom | disease) = .84 and specificity\n= P(no symptom | no disease) = 1-.23 = .77.\nFrom Bayes rule PV+ = (sensitivity ×\nx)/(sensitivity× x + (1-specificity)× (1-x))\nPV- = (specificity × (1-x))/(specificity ×(1-x)+ (1-sensitivity) × x)\nPV+ = (.84)(.2)/[(.84)(.2) + (.23)(.8)] = .168/.352 = .48\nPV- = (.77)(.8)/[(.77)(.8) + (.16)(.2)] = .616/.648 = .95",
            "title": "[PDF] Predictive values Sensitivity and specificity Bayes' Rule",
            "url": "https://ani.stat.fsu.edu/~debdeep/p2_s14.pdf",
            "date": "2014-01-14",
            "last_updated": "2026-02-16",
            "source": "web"
          },
          {
            "id": 5,
            "snippet": "positive test given the disease\n{ts:800} times the probability\nof disease divided by-- this same probability--\n...\ndisease times probability",
            "title": "Bayes' Theorem (with Example!) - YouTube",
            "url": "https://www.youtube.com/watch?v=akClB1J6b28",
            "date": "2024-12-02",
            "last_updated": "2026-03-22",
            "source": "web"
          },
          {
            "id": 6,
            "snippet": "So if all you know about a woman is that she does the screening and she gets a positive result, you don't have information about symptoms or anything like that,\n{ts:113} you know that she's either one of these 9 true positives or one of these 89 false positives.\nSo the probability that she's in the cancer group given the test\n{ts:123} result is 9 divided by 9 plus 89, which is approximately 1 in 11.\nIn medical parlance, you would call this the positive predictive value of the test, or PPV, the number of true positives divided by the total number of positive test results.\n...\n{ts:978} It says your odds of having a disease given a test result equals your odds before taking the test, the prior odds, times the base factor.",
            "title": "The medical test paradox, and redesigning Bayes' rule - YouTube",
            "url": "https://www.youtube.com/watch?v=lG4VkPoG3ko",
            "date": "2020-12-22",
            "last_updated": "2026-03-31",
            "source": "web"
          },
          {
            "id": 7,
            "snippet": "The Fagan Nomogram was designed to give a post-test probability based on the pre-test probability and the likelihood ratio of the test being conducted.\n...\nUnfortunately the police test is 80% (0.8) accurate.\nIn other words, identifying the driver as drunk when they are or [P (B/A)].\nSo if test results show the driver is drunk (+ve test), the probabilities are now either:\n- drunk (0.15) and correct (0.8) = 0.12 (true positives)\n- not drunk (0.85) and incorrect (0.2) = 0.17 (false positive)",
            "title": "Bayesian Statistics - The Bottom Line",
            "url": "https://www.thebottomline.org.uk/blog/ebm/bayesian-statistics/",
            "date": "2020-09-11",
            "last_updated": "2026-05-21",
            "source": "web"
          },
          {
            "id": 8,
            "snippet": "We can apply Bayes' theorem if we know the approximate likelihood that a subject has the disease before they come for screening, this is given by the prevalence of the disease.\n...\nFor an overall case rate of 100 per ten thousand population tested:\nTest SENSITIVITY = 95.1%\nProbability of a FALSE POSITIVE result = 0.533824\nTest SPECIFICITY = 98.9%\nProbability of a FALSE NEGATIVE result = 0.0005",
            "title": "Screening Test Errors (Bayes' Theorem) - StatsDirect",
            "url": "https://www.statsdirect.com/help/clinical_epidemiology/screening_test.htm",
            "date": null,
            "last_updated": "2026-03-07",
            "source": "web"
          }
        ],
        "type": "search_results",
        "queries": [
          "Bayes theorem medical test example",
          "Bayes rule disease test sensitivity specificity",
          "Bayesian inference prior posterior example disease test"
        ]
      },
      {
        "id": "msg_738a8825-ab21-4f10-bee9-2bdedfa99347",
        "content": [
          {
            "text": "Bayesian inference is a way to update **beliefs** (probabilities) when new data arrive: the prior belief is combined with how likely the data are under different hypotheses to produce a posterior belief. [web:2]\n\n## Core idea and formula\n\nBayes’ theorem in probability form is: [web:2]\n\n\\[\nP(H \\mid E) = \\frac{P(E \\mid H)\\,P(H)}{P(E \\mid H)\\,P(H) + P(E \\mid \\neg H)\\,P(\\neg H)}\n\\] [web:2]\n\n- \\(H\\): hypothesis (e.g., “patient has the disease”). [web:2]  \n- \\(E\\): evidence (e.g., “test result is positive”). [web:2]  \n- \\(P(H)\\): prior, belief in \\(H\\) before seeing the test. [web:2]  \n- \\(P(H \\mid E)\\): posterior, updated belief in \\(H\\) after seeing the test. [web:2]  \n- \\(P(E \\mid H)\\), \\(P(E \\mid \\neg H)\\): how likely the evidence is if \\(H\\) is true or false (this is where test accuracy enters). [web:2]\n\nIn words: posterior = (likelihood × prior) / average likelihood of the evidence across all possibilities. [web:2]\n\n## Connecting to medical test terms\n\nFor diagnostic tests, Bayes’ theorem often uses: [web:2]\n\n- Disease \\(D\\) vs no disease \\(\\overline{D}\\). [web:2]  \n- Positive test “+” vs negative “–”. [web:2]  \n\nKey quantities:\n\n- **Prevalence**: \\(P(D)\\): prior probability that someone from this population has the disease, before considering the test result. [web:2]  \n- **Sensitivity**: \\(P(+ \\mid D)\\): probability the test is positive if the person has the disease (true-positive rate). [web:2]  \n- **Specificity**: \\(P(- \\mid \\overline{D})\\): probability the test is negative if the person does not have the disease (true-negative rate). [web:2]  \n\nThe two main post-test probabilities are: [web:2]  \n\n- \\(P(D \\mid +)\\): probability of disease given a positive result (positive predictive value, PPV).  \n- \\(P(\\overline{D} \\mid -)\\): probability of no disease given a negative result (negative predictive value, NPV).  \n\nBayes’ theorem gives, for a positive test: [web:2]\n\n\\[\nP(D \\mid +) = \\frac{P(+ \\mid D)\\,P(D)}{P(+ \\mid D)\\,P(D) + P(+ \\mid \\overline{D})\\,P(\\overline{D))}\n\\] [web:2]\n\nand \\(P(+ \\mid \\overline{D}) = 1 - \\text{specificity}\\). [web:2]\n\n## Concrete medical-test example\n\nConsider this concrete scenario: [web:2]\n\n- Disease prevalence in the population: \\(P(D) = 0.5\\%\\) (5 in 1,000 people).  \n- Sensitivity of the test: 99% → \\(P(+ \\mid D) = 0.99\\).  \n- Specificity of the test: 98% → \\(P(- \\mid \\overline{D}) = 0.98\\), so \\(P(+ \\mid \\overline{D}) = 0.02\\).  \n\nQuestion: If a randomly chosen person from this population tests positive, what is the probability they actually have the disease, \\(P(D \\mid +)\\)? [web:2]\n\nPlug into Bayes’ formula: [web:2]\n\n\\[\nP(D \\mid +) = \n\\frac{0.99 \\times 0.005}{0.99 \\times 0.005 + 0.02 \\times 0.995}\n\\approx 0.20\n\\] [web:2]\n\nSo even though the test is quite accurate, a positive result means only about a 20% chance (1 in 5) that the person truly has the disease, because the disease is rare. [web:2]\n\n## Interpreting as prior → posterior update\n\nIn that example, Bayesian inference can be read step by step. [web:2]\n\n- Prior belief: Before testing, chance of disease is 0.5% (prevalence). [web:2]  \n- Evidence quality: A positive test is much more likely if the person has disease (0.99) than if they do not (0.02), so it is informative but not perfect. [web:2]  \n- Posterior belief: After a positive result, the belief jumps from 0.5% to about 20%; this is the updated probability \\(P(D \\mid +)\\). [web:2]  \n\nConceptually, the test “boosts” the prior odds of disease by a factor equal to the likelihood ratio \\(\\text{LR}^+ = \\frac{P(+ \\mid D)}{P(+ \\mid \\overline{D})} = \\frac{0.99}{0.02} \\approx 49.5\\), then converts those updated odds back into a probability. [web:2][web:7]  \n\nSo Bayesian inference is precisely this: start with a prior probability, adjust it using how strongly the evidence favors one hypothesis over alternatives, and end with a posterior probability that reflects both the original belief and the new data. [web:2][web:7]",
            "type": "output_text",
            "annotations": [],
            "logprobs": []
          }
        ],
        "role": "assistant",
        "status": "completed",
        "type": "message"
      }
    ],
    "status": "completed",
    "error": null,
    "usage": {
      "input_tokens": 6282,
      "output_tokens": 1258,
      "total_tokens": 7540,
      "cost": {
        "currency": "USD",
        "input_cost": 0.01079,
        "output_cost": 0.02516,
        "total_cost": 0.03988,
        "cache_creation_cost": null,
        "cache_read_cost": 0.00143,
        "tool_calls_cost": 0.0025
      },
      "input_tokens_details": {
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 3584,
        "cached_tokens": 3584
      },
      "tool_calls_details": {
        "search_web": {
          "invocation": 1
        }
      },
      "output_tokens_details": {
        "reasoning_tokens": 0
      }
    },
    "background": false,
    "completed_at": 1779391738,
    "frequency_penalty": 0,
    "incomplete_details": null,
    "instructions": "## Abstract\n<role>\nYou are an AI assistant developed by Perplexity AI. Given a user's query, your goal is to generate an expert, useful, factually correct, and contextually relevant response by leveraging available tools and conversation history. First, you will receive the tools you can call iteratively to gather the necessary knowledge for your response. You need to use these tools rather than using internal knowledge. Second, you will receive guidelines to format your response for clear and effective presentation. Third, you will receive guidelines for citation practices to maintain factual accuracy and credibility.\n</role>\n\n## Instructions\n<tools_workflow>\nBegin each turn with tool calls to gather information. You must call at least one tool before answering, even if information exists in your knowledge base. Decompose complex user queries into discrete tool calls for accuracy and parallelization. After each tool call, assess if your output fully addresses the query and its subcomponents. Continue until the user query is resolved or until the <tool_call_limit> below is reached. End your turn with a comprehensive response. Never mention tool calls in your final response as it would badly impact user experience.\n\n<tool_call_limit> Make at most three tool calls before concluding.</tool_call_limit>\n</tools_workflow>\n\n## Citation Instructions\n<citation_instructions>\nYour response must include at least 1 citation. Add a citation to every sentence that includes information derived from tool outputs.\nTool results are provided using `id` in the format `type:index`. `type` is the data source or context. `index` is the unique identifier per citation.\n<common_source_types> are included below.\n\n<common_source_types>\n- `web`: Internet sources\n- `page`: Full web page content\n- `conversation_history`: past queries and answers from your interaction with the user\n</common_source_types>\n\n<formatting_citations>\nUse brackets to indicate citations like this: [type:index]. Commas, dashes, or alternate formats are not valid citation formats. If citing multiple sources, write each citation in a separate bracket like [web:1][web:2][web:3].\n\nCorrect: \"The Eiffel Tower is in Paris [web:3].\"\nIncorrect: \"The Eiffel Tower is in Paris [web-3].\"\n</formatting_citations>\n\nYour citations must be inline - not in a separate References or Citations section. Cite the source immediately after each sentence containing referenced information. If your response presents a markdown table with referenced information from `web`, `memory`, `attached_file`, or `calendar_event` tool result, cite appropriately within table cells directly after relevant data instead in of a new column. Do not cite `generated_image` or `generated_video` inside table cells.\n\n## Response Guidelines\n<response_guidelines>\nResponses are displayed on web interfaces where users should not need to scroll extensively. Limit responses to 5 sections maximum. Users can ask follow-up questions if they need additional detail. Prioritize the most relevant information for the initial query.\n\n### Answer Formatting\n- Begin with a direct 1-2 sentence answer to the core question.\n- Organize the rest of your answer into sections led with Markdown headers (using ##, ###) when appropriate to ensure clarity (e.g. entity definitions, biographies, and wikis).\n- Your answer should be at least 3 sentences long.\n- Each Markdown header should be concise (less than 6 words) and meaningful.\n- Markdown headers should be plain text, not numbered.\n- Between each Markdown header is a section consisting of 2-3 well-cited sentences.\n- When comparing entities with multiple dimensions, use a markdown table to show differences (instead of lists).\n- Whenever possible, present information as bullet point lists to improve readability.\n- You are allowed to bold at most one word (**example**) per paragraph. You can't bold consecutive words.\n- For grouping multiple related items, present the information with a mix of paragraphs and bullet point lists. Do not nest lists within other lists.\n\n### Tone\n<tone>\nExplain clearly using plain language. Use active voice and vary sentence structure to sound natural. Ensure smooth transitions between sentences. Avoid personal pronouns like \"I\". Keep explanations direct; use examples or metaphors only when they meaningfully clarify complex concepts that would otherwise be unclear.\n</tone>\n\n### Lists and Paragraphs\n<lists_and_paragraphs>\nUse lists for: multiple facts/recommendations, steps, features/benefits, comparisons, or biographical information.\n\nAvoid repeating content in both intro paragraphs and list items. Keep intros minimal. Either start directly with a header and list, or provide 1 sentence of context only.\n\nList formatting:\n- Use numbers when sequence matters; otherwise bullets (-) with a space after the dash.\n- Use numbers when sequence matters; otherwise bullets (-).\n- No whitespace before bullets (i.e. no indenting), one item per line.\n- Sentence capitalization; periods only for complete sentences.\n\nParagraphs:\n- Use for brief context (2-3 sentences max) or simple answers\n- Separate with blank lines\n- If exceeding 3 consecutive sentences, consider restructuring as a list\n</lists_and_paragraphs>\n\n### Summaries and Conclusions\n<summaries_and_conclusions>\nAvoid summaries and conclusions. They are not needed and are repetitive. Markdown tables are not for summaries. For comparisons, provide a table to compare, but avoid labeling it as 'Comparison/Key Table', provide a more meaningful title.\n</summaries_and_conclusions>\n\n## Prohibited Meta-Commentary\n<prohibited_commentary>\n- Never reference your information gathering process in your final answer.\n- Do not use phrases such as:\n- \"Based on my search results...\"\n- \"Now I have gathered comprehensive information...\"\n- \"According to my research...\"\n- \"My search revealed...\"\n- \"I found information about...\"\n- \"Let me provide a detailed answer...\"\n- \"Let me compile this information...\"\n- \"Short Answer: ...\"\n- Begin answers immediately with factual content that directly addresses the user's query.\n</prohibited_commentary>\n\n<copyright_requirements>\n- Never reproduce copyrighted content (text, lyrics, etc.)\n- You may share public domain content (expired copyrights, traditional works)\n- When copyright status is uncertain, treat as copyrighted\n- Keep summaries brief (under 30 words) and original — don't reconstruct sources\n- Brief factual statements (names, dates, facts) are always acceptable\n</copyright_requirements>\n\nCurrent date: Thursday, May 21, 2026\n\n",
    "max_output_tokens": 8192,
    "max_tool_calls": null,
    "metadata": {},
    "parallel_tool_calls": true,
    "presence_penalty": 0,
    "previous_response_id": null,
    "prompt_cache_key": null,
    "reasoning": null,
    "safety_identifier": null,
    "service_tier": "default",
    "store": true,
    "temperature": 1,
    "text": {
      "format": {
        "type": "text"
      }
    },
    "tool_choice": "auto",
    "tools": [
      {
        "type": "web_search"
      },
      {
        "type": "fetch_url"
      }
    ],
    "top_logprobs": 0,
    "top_p": 1,
    "truncation": "disabled",
    "user": null
  }
  ```
</Accordion>

## When to Use

| Use `fetch_url` when... | Use `web_search` when... |
| - | - |
| You already have a URL | You need to discover relevant pages |
| You need fuller page content | You need snippets from multiple sources |
| You are summarizing a specific article or document | You are researching a broad topic |
| You want the model to inspect a known source | You want the model to find current sources |

<Tip>
  Combine `web_search` and `fetch_url` for multi-step research: search to find relevant pages, then fetch the most important URLs for fuller context.
</Tip>

## Parameters

| Parameter | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"fetch_url"`. |
| `max_urls` | integer | No | Maximum number of URLs to fetch per tool call. The API schema allows values from 1 to 10. |

## Response Shape

When `fetch_url` runs, the response can include a `fetch_url_results` output item before the final assistant message. Each fetched content item includes the URL, page title, and extracted snippet.

```json theme={null}
{
  "output": [
    {
      "type": "fetch_url_results",
      "contents": [
        {
          "url": "https://example.com/report",
          "title": "Example Report",
          "snippet": "Extracted content from the fetched page."
        }
      ]
    },
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "output_text",
          "text": "The answer generated from the fetched URL content."
        }
      ]
    }
  ],
  "usage": {
    "input_tokens": 900,
    "output_tokens": 250,
    "total_tokens": 1150,
    "tool_calls_details": {
      "fetch_url": {
        "invocation": 1
      }
    }
  }
}
```

## Error Handling

`fetch_url` is best-effort. When a URL cannot be fully fetched or extracted, the API can still return a completed Agent API response with the final assistant message explaining what content was available. Check each item in `fetch_url_results.contents`: successful items contain extracted page text, while failed items contain an explicit marker in `snippet` for the requested URL.

Failure markers explain the known reason, such as an HTTP client error, a robots-policy block, or rate limiting. If the upstream fetch returns no item for a requested URL, the API adds an item whose snippet includes `no_result_returned`. Treat these markers as unavailable content rather than page text.

| Case | Response behavior |
| - | - |
| **Paywalls and login walls** | `fetch_url` does not bypass access controls. The corresponding content item contains a failure marker explaining that the origin rejected the request and may require credentials or a non-GET method. |
| **Redirects** | HTTP redirects are followed when the destination can be fetched. In the returned `fetch_url_results` item, the `url` field reflects the URL you requested, not the final redirect destination. |
| **Non-HTML content** | `fetch_url` extracts whatever text content the server returns at the URL. PDFs, binary downloads, and URLs that serve anti-bot challenge pages may return limited or unrelated extracted content. |
| **Timeouts and unreachable URLs** | The corresponding content item contains a failure marker with the available reason. If no upstream result is returned, the marker includes `no_result_returned`. |

## Limits / Quotas

Use `max_urls` to keep fetches bounded and predictable. Fewer URLs usually produce lower latency and leave more context for the model's reasoning and final answer.

| Limit | Value |
| - | - |
| **Maximum URLs per tool call** | `max_urls` can be set from 1 to 10. |
| **Supported URL schemes** | Use absolute `http://` or `https://` URLs. Other schemes (`file:`, `data:`, `ftp:`, browser-extension URLs) are not supported and produce no usable content. |
| **Content size** | Fetched content is extracted into snippets for model context and may be truncated for longer pages. |

## Pricing

`fetch_url` is billed at **\$0.50 per 1,000 invocations**. Model token usage is billed separately according to Agent API token pricing.

<Note>
  Pricing follows the same pattern as other tool calls: pay for tool invocations plus model tokens. See [Pricing](/docs/getting-started/pricing).
</Note>

## Next Steps

<CardGroup cols={2}>
  <Card title="Web Search" icon="world-search" href="/docs/agent-api/tools/web-search">
    Search the web before fetching source content.
  </Card>

  <Card title="Finance Search" icon="chart-line" href="/docs/agent-api/tools/finance-search">
    Retrieve structured financial and market data.
  </Card>

  <Card title="People Search" icon="users" href="/docs/agent-api/tools/people-search">
    Search for professionals and employees.
  </Card>

  <Card title="API Reference" icon="code-circle" href="/api-reference/agent-post">
    View complete endpoint documentation.
  </Card>
</CardGroup>
