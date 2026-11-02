> ## Documentation Index
> Fetch the complete documentation index at: https://docs.perplexity.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# People Search

> Search for professionals, employees, and people using People Search in the Agent API

## Overview

The `people_search` tool enables models to find people and retrieve their professional information such as names, job titles, and companies. Use it to power workflows like lead research, recruiting pipelines, or organizational mapping.

Use it when your application needs to:

* Look up a specific person's professional background
* Find employees at a company by role or title
* Identify professionals in a particular field or location
* Research leadership teams or organizational structures

The model decides when to invoke `people_search` based on your prompt and instructions.

## Coverage

People Search can query public professional profiles and related professional context across several dimensions:

| Query by | Example prompt |
| - | - |
| **Name** | "Find Sarah Chen and summarize her current professional role." |
| **Role** | "Find chief revenue officers at late-stage AI startups." |
| **Company** | "Find product leaders who work at Stripe." |
| **Education** | "Find Stanford alumni working in machine learning research." |
| **Skill** | "Find professionals with Kubernetes platform engineering experience." |
| **Location** | "Find fintech compliance leaders in New York." |

<Warning>
  **Privacy and acceptable use:** Use People Search only for legitimate professional research workflows. Do not use it for harassment, doxxing, stalking, or unauthorized background screening. You are responsible for complying with applicable privacy, employment, and data protection laws, including GDPR and CCPA where they apply. The API returns publicly available professional information only.
</Warning>

### Query Tips

For the best results, guide the model with specific details in your prompt:

| Approach | Example prompt |
| - | - |
| **Name + company** | "Find John Smith who works at Google" |
| **Role + company** | "Who is the Head of Design at Figma?" |
| **Role + location** | "Find marketing directors in San Francisco" |
| **Role + field** | "Find machine learning researchers at Stanford" |

<Info>
  The tool works best for people-related queries — it is not suited for general web search.
</Info>

## Tiered Configurations

The following four tiered configurations span the speed/quality tradeoff for workloads that mix `people_search` with `web_search` and `fetch_url`. Each tier defines a model, reasoning effort, tool selection, per-tool token budgets, and step limits. Use them as starting points and adjust per your latency, depth, and accuracy needs.

| Tier | Model | Reasoning | Tools | Max Steps | Use When |
| - | - | - | - | - | - |
| **pro** | `openai/gpt-5.6-luna` | medium | `people_search`, `web_search`, `fetch_url` | 5 | Balanced people/web research with moderate depth |
| **deep** | `google/gemini-3-flash-preview` | high | `people_search`, `web_search`, `fetch_url` | 10 | Deeper analysis when latency budget is moderate but quality matters |
| **advanced-deep** | `openai/gpt-5.6-sol` | medium | `people_search`, `web_search`, `fetch_url` | 10 | High-quality, multi-step research with long context |
| **ultra-deep** | `openai/gpt-5.6-sol` | high | `people_search`, `web_search`, `fetch_url` | 50 | Maximum-depth investigations with the largest token budgets and step counts |

<Info>
  The `bigtokens` settings used by pro, deep, and advanced-deep refer to `max_tokens=10000` and `max_tokens_per_page=1000` on the `people_search` and `web_search` tools. The `xltokens` settings used by ultra-deep refer to `max_tokens=20000` and `max_tokens_per_page=2000`.
</Info>

<Warning>
  **ultra-deep heads-up:** `openai/gpt-5.6-sol` with high reasoning and streaming may be flaky upstream. If requests hang, fall back to `medium` reasoning effort or disable streaming.
</Warning>

### pro

Balanced configuration with all three tools enabled and moderate reasoning effort.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()


  def get_output_text(response) -> str:
      return "".join(
          content.text
          for item in response.output or []
          if getattr(item, "type", None) == "message"
          for content in getattr(item, "content", None) or []
          if getattr(content, "type", None) == "output_text"
      )


  response = client.responses.create(
      model="openai/gpt-5.6-luna",
      reasoning={"effort": "medium"},
      tools=[
          {
              "type": "people_search",
              "max_tokens": 10000,
              "max_tokens_per_page": 1000,
          },
          {
              "type": "web_search",
              "max_tokens": 10000,
              "max_tokens_per_page": 1000,
          },
          {"type": "fetch_url"},
      ],
      max_steps=5,
      input="Who is the current CEO of Notion, and what was their background before joining the company?",
  )

  print(get_output_text(response))
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-luna',
    reasoning: { effort: 'medium' },
    tools: [
      {
        type: 'people_search',
        max_tokens: 10000,
        max_tokens_per_page: 1000,
      },
      {
        type: 'web_search',
        max_tokens: 10000,
        max_tokens_per_page: 1000,
      },
      { type: 'fetch_url' },
    ],
    max_steps: 5,
    input: 'Who is the current CEO of Notion, and what was their background before joining the company?',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-luna",
      "reasoning": {"effort": "medium"},
      "tools": [
        {
          "type": "people_search",
          "max_tokens": 10000,
          "max_tokens_per_page": 1000
        },
        {
          "type": "web_search",
          "max_tokens": 10000,
          "max_tokens_per_page": 1000
        },
        {"type": "fetch_url"}
      ],
      "max_steps": 5,
      "input": "Who is the current CEO of Notion, and what was their background before joining the company?"
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "3f87daf1-90d8-421a-9459-45f4ca027591",
    "results": [
      {
        "snippet": "In today’s article, we will meet Ivan Zhao, a visionary entrepreneur, coding genius, and co-founder of Notion, a groundbreaking company now valued at $10 billion.\n...\nIn the early 2010s, Ivan Zhao moved from Canada to the US, looking for a designer role.\nAkshay Kothari, then running his own company, reached out to hire him.\nWhile Ivan ultimately chose a different opportunity, the two stayed in touch, forming a bond that would later prove pivotal.\nIn 2013, Ivan partnered with Simon Last, who was in his early twenties at the time.\nSimon impressed Ivan with his exceptional talent and remarkable portfolio, leading Ivan to hire him as a key collaborator on the Notion project.\n...\nIn the summer of 2018, Ivan, looking for a COO to help scale Notion, offered the position to Akshay Kothari, who was eager to dive back into building something new, and he joined the company as a COO when it was just 8 people strong.\nThis strategic move paid off as Notion’s growth skyrocketed, going from 8 to nearly 500 employees in just 4 years.",
        "title": "The Phenomenal Journey of Ivan Zhao, Notion's Founder - KITRUM",
        "url": "https://kitrum.com/blog/the-phenomenal-journey-of-ivan-zhao-notions-founder/",
        "date": "2025-01-14",
        "last_updated": "2025-07-09"
      },
      {
        "snippet": "Notion Labs, Inc. was created as a startup in San Francisco, California, founded in 2013 by Ivan Zhao, Akshay Kothari, Chris Prucha, Jessica Lam, Simon Last, and Toby Schachman.",
        "title": "Notion (productivity software) - Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Notion_(productivity_software)",
        "date": "2018-10-10",
        "last_updated": "2026-05-18"
      },
      {
        "snippet": "",
        "title": "Notion's Founder Deleted 3 Years of Work. Here's Why. - YouTube",
        "url": "https://www.youtube.com/watch?v=hYWMyXMkZmE",
        "date": "2026-03-04",
        "last_updated": "2026-05-26"
      },
      {
        "snippet": "",
        "title": "Notion CEO Ivan Zhao: Augmenting Human Intellect | Sequoia Capital",
        "url": "https://sequoiacap.com/article/notion-spotlight/",
        "date": "2022-10-13",
        "last_updated": "2026-05-09"
      },
      {
        "snippet": "Brett Jurgens is the co-founder and CEO of Notion, the complete home awareness solution, powered by a multi-purpose IoT smart home sensor.\nPrior to founding Notion, Brett co-founded and ran Sway Marketing, which aimed to more effectively connect local area businesses with CU students.\nBrett went on to work as an analyst in the Private Placements Group at Piper Jaffray, where he helped private, growing companies raise growth capital from institutional investors.\nBrett was then hired as the first employee of Denver-based consumer product startup UrgentRx, helping drive business development and operations roles, launch the initial product line, reach $3 million in sales, sell into 20,000 retail locations including Walmart and Walgreens and raise $10 million in capital.\nBrett led Notion through the Techstars accelerator program in 2014, which culminated in a successful crowdfunding campaign on Kickstarter that raised over $200k.\nFrom there, Notion was accepted to and graduated from MetaProp's 2015 accelerator class.\n...\nSince founding Notion in 2013, Brett has led Notion through multiple rounds of fundraising, closing $15.7M to date.\n...\nPrior to closing Notion’s Series A funding, Notion already partnered with 3 of the top 5 insurance companies in the US and one of the largest consumer electronics companies in the world.",
        "title": "Brett Jurgens | CEO - Notion | Forbes Technology Council",
        "url": "https://councils.forbes.com/profile/Brett-Jurgens-CEO-Notion/70c506c7-3b64-4096-9cb1-73ccb2045b44",
        "date": "2020-01-24",
        "last_updated": "2025-03-01"
      },
      {
        "snippet": "",
        "title": "9-Year Hustle to Achieve a Single GoalㅣNotion's Cofounders",
        "url": "https://www.youtube.com/watch?v=FPYl7nIKRbA",
        "date": "2023-02-14",
        "last_updated": "2026-03-20"
      },
      {
        "snippet": "—\n**Ivan Zhao** is the co-founder and CEO of Notion.\nIvan shares the untold story of Notion, from nearly running out of database space during Covid to finding product-market fit after several “lost years,” and the hard-won lessons along the way.\n...\n7. Ivan’s unique journey from a small town in China",
        "title": "Notion's lost years, its near collapse during Covid, staying small to ...",
        "url": "https://www.lennysnewsletter.com/p/inside-notion-ivan-zhao",
        "date": "2025-03-06",
        "last_updated": "2026-05-23"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

### deep

Higher reasoning effort and step count with a generous output budget for fuller multi-source answers.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()


  def get_output_text(response) -> str:
      return "".join(
          content.text
          for item in response.output or []
          if getattr(item, "type", None) == "message"
          for content in getattr(item, "content", None) or []
          if getattr(content, "type", None) == "output_text"
      )


  response = client.responses.create(
      model="google/gemini-3-flash-preview",
      reasoning={"effort": "high"},
      tools=[
          {
              "type": "people_search",
              "max_tokens": 10000,
              "max_tokens_per_page": 1000,
          },
          {
              "type": "web_search",
              "max_tokens": 10000,
              "max_tokens_per_page": 1000,
          },
          {"type": "fetch_url"},
      ],
      max_steps=10,
      max_output_tokens=16000,
      input="Map the executive leadership team at Linear (linear.app) and summarize each leader's prior roles using publicly available sources.",
  )

  print(get_output_text(response))
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'google/gemini-3-flash-preview',
    reasoning: { effort: 'high' },
    tools: [
      {
        type: 'people_search',
        max_tokens: 10000,
        max_tokens_per_page: 1000,
      },
      {
        type: 'web_search',
        max_tokens: 10000,
        max_tokens_per_page: 1000,
      },
      { type: 'fetch_url' },
    ],
    max_steps: 10,
    max_output_tokens: 16000,
    input: "Map the executive leadership team at Linear (linear.app) and summarize each leader's prior roles using publicly available sources.",
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "google/gemini-3-flash-preview",
      "reasoning": {"effort": "high"},
      "tools": [
        {
          "type": "people_search",
          "max_tokens": 10000,
          "max_tokens_per_page": 1000
        },
        {
          "type": "web_search",
          "max_tokens": 10000,
          "max_tokens_per_page": 1000
        },
        {"type": "fetch_url"}
      ],
      "max_steps": 10,
      "max_output_tokens": 16000,
      "input": "Map the executive team at a mid-size SaaS company and explain each leader'\''s prior roles."
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "8d6f6fd4-1bd0-4646-b6c5-a0ac42d8cfc1",
    "results": [
      {
        "snippet": "## Meet the team behind Linear\nWe are designers and engineers.\n...\nWe are a diverse team of individuals, all makers at heart.\nWe’re hiring →\nKarri SaarinenCo-founder, CEO\nJori LalloCo-founder, CPO\nTuomas ArtmanCo-founder, CTO\nCristina CordovaCOO\nNan YuHead of Product\nTom MoorHead of Engineering\nCasey BertenthalHead of Sales\nJamie FinniganHead of Security\n- Tim Qi\n- Matthew Roberts\n- Matthijs Wolting\n- Josh Pyles\n- Nathalie Alex\n- Dominic Wong\n- Meg Wayne\n- Mingjie Jiang\n- Alan Doyle\n- Alex Suevalov\n- Anthony Vidalez\n- Saneel Prabhu\n...\n- Jon Phey",
        "title": "About",
        "url": "https://linear.app/about",
        "date": "2020-12-03",
        "last_updated": "2026-05-19"
      },
      {
        "snippet": "Linear is a software development company founded in 2019 by Karri Saarinen and Tuomas Artman.\n...\nThe Linear leadership team combines deep expertise in software engineering, product management, and operations.\n...\n### Karri Saarinen - CEO, Co-founder\nKarri Saarinen is the CEO and Co-founder of Linear, shaping the company's vision to create a top-tier project and issue tracking platform focused on quality and speed in software development.\n...\nKarri co-founded Linear and has served as CEO since 2019, demonstrating a deep commitment to software craftsmanship and innovation.\n...\n### Jori Lallo - Co-founder\nJori Lallo is a Co-founder of Linear, instrumental in establishing its founding vision and developing the core product.\nHe is pivotal in shaping company culture and guiding product evolution, bringing the Linear management team deep technical and design contributions.\n...\n### Tuomas Artman - CTO, Co-founder\nTuomas Artman is the CTO and Co-founder of Linear, responsible for driving the company’s technology strategy, engineering architecture, and scaling infrastructure.\nTuomas Artman ensures Linear’s performance and reliability, leading teams that deliver scalable features and platform innovation.\nBefore joining the Linear executive team, Tuomas held engineering and management positions at Uber and Groupon, focusing on distributed systems and user-centric product design.\nHe holds a degree from the University of Helsinki and possesses multiple software-related patents, further solidifying the technical leadership within Linear’s management team.\n### Cristina Cordova - COO\nCristina Cordova serves as Chief Operating Officer (COO) at Linear, where she builds and scales marketing, sales, operations, data, and talent teams to support company expansion.\nCristina Cordova drives growth and operational efficiency, leveraging her prior leadership roles at Stripe and Notion.\n...\n### Nan Yu - Head of Product\nNan Yu leads the product organization at Linear, crafting and refining features that drive value for customers and deliver world-class user experiences.\nNan Yu sets product strategy and oversees execution, ensuring alignment with both customer needs and company ambitions.\nNan’s expertise was shaped by previous product leadership positions at Mode, Everlane, and Bank of America.\nShe studied Electrical Engineering and Computer Science at the University of California, Berkeley.\nHer technical background and multidisciplinary approach have been essential in advancing Linear’s product vision within the broader Linear executives team.\n### Casey Bertenthal - Head of Sales\nCasey Bertenthal leads sales at Linear, focusing on revenue growth, customer acquisition, and retention.\nCasey Bertenthal excels at building high-performing sales organizations and developing strategies for engaging new and existing customers.\nCasey brings extensive SaaS sales leadership experience, previously working with companies like Abstract and Wake.\nHe studied Political Science at Northeastern University and has consistently delivered strong sales results, contributing significantly to Linear’s business expansion.",
        "title": "Linear's Executive Team & Leadership | Meet Our Leaders - Exa",
        "url": "https://websets.exa.ai/websets/directory/linear-executives",
        "date": "2026-05-21",
        "last_updated": "2026-05-21"
      },
      {
        "snippet": "Linear has always been a fully remote company.\nToday, our small but mighty team is distributed across North America and Europe.\n...\nWe are all makers at heart and care deeply about the quality of our work, down to the smallest detail.We're hiring Karri SaarinenCo-founder, CEOJori LalloCo-founder, CPOTuomas ArtmanCo-founder, CTOTom MoorHead of EngineeringNan YuHead of ProductCristina CordovaCOOCasey\nBertenthalHead of SalesJamie FinniganHead of SecurityTim QiMatthew RobertsMatthijs WoltingJosh PylesNathalie AlexDom WongMeg WayneMingjie JiangAlan DoyleAlex SuevalovAnthony VidalezSaneel PrabhuIgor SechynAxel NiklassonDavina BakerMufeez\nAmjadTony WoosterBen KinneySimone JacobsZoe WellnerBojan JoveskiYann-Edern GilletPaul MacgregorEmiel JansonDylan HamiltonEitan MeiselsSteven DeMartiniAmelia CellarPaco CourseyKristin BoyerPeter TraversMaciek PekalaSkyline\nLauJesse HartheimerAaron QuinnLena VuRobb BöhnkeJacob ShumwayEmil KowalskiHilary HobelSean McGivernAndreas EldhAllie HughesUros SmolnikErin FreyLauren GrantMariah BardoRomain CascinoMelissa RossMaya\nNedeljković BatićSean CallahanLiam O'ConnorSarah BarnekowAdrien GriveauBrando RocheKatie RoyerBryan SternAlexandra Lapinsky WilsonTyler BlackGavin NelsonLukas EipertDaniel Warner SmithSabin RomanLuke SchneiderHaley ThurstonGrace LemanIsha\nKumarDidier CatzDrew HuppeWarner PriceSid BhargavaJack ManganGino FordianiEma MilojkovicKyle WardIvy MurphyChris MaggioColin DunnMel MierGuglielmo D'AnnaLeela Senthil NathanBrian HenderyAlessandro OddoneConor MuirheadColin RutanJulian LehrAlyssa GarrisonAllison WeiKenneth SkovhusDoug ParkerMarcos FiscalPaul DijouGuillaume Lachaud\n...\nOur backers include highly accomplished venture firms and some of the world’s most exceptional founders and product builders.Miles ClementsPartnerStephanie ZhanPartnerDylan FieldCEO, FigmaPatrick CollisonCEO, StripeStewart ButterfieldFormer CEO, SlackGuillermo RauchCEO, VercelDick CostoloFormer CEO\n, TwitterJosh MillerCEO, Browser CompanyAndrew MasonCEO, DescriptImmad AkhundCEO, MercuryClaire Hughes JohnsonFormer COO, StripeJorn van DijkCEO, FramerChristina CacioppoCEO, VantaJob van der VoortCEO, RemoteIlkka PaananenCEO, SupercellAnthony GuoCTO, RetoolGustaf AlströmerPartner, Y CombinatorAkash GargFormer CTO, Afterpay",
        "title": "About - Linear",
        "url": "https://linear.app/about?_rsc=15b46",
        "date": "2025-12-19",
        "last_updated": "2026-01-18"
      },
      {
        "snippet": "Linear has always been a fully remote company.\nToday, our small but mighty team is distributed across North America and Europe.\n...\nOur backers include highly accomplished venture firms and some of the world’s most exceptional founders and product builders.Miles ClementsPartnerStephanie ZhanPartnerDylan FieldCEO, FigmaPatrick CollisonCEO, StripeStewart ButterfieldFormer CEO, SlackGuillermo RauchCEO, VercelDick CostoloFormer CEO\n, TwitterJosh MillerCEO, Browser CompanyAndrew MasonCEO, DescriptImmad AkhundCEO, MercuryClaire Hughes JohnsonFormer COO, StripeJorn van DijkCEO, FramerChristina CacioppoCEO, VantaJob van der VoortCEO, RemoteIlkka PaananenCEO, SupercellAnthony GuoCTO, RetoolGustaf AlströmerPartner, Y CombinatorAkash GargFormer CTO, Afterpay",
        "title": "About – Linear",
        "url": "https://linear.app/about?_rsc=xl36s",
        "date": "2025-01-01",
        "last_updated": "2025-03-01"
      },
      {
        "snippet": "## Org chart\nKarri Saarinen\nCEO & co-Founder\nCollapse\nCristina Cordova\nCOO\nNan Yu\nHead of Product\n### Board & advisors\nJori Lallo\nCo-Founder\nDylan Field\nInvestor\nGustaf Älströmer\nInvestor\nStephanie Zhan\nBoard Member\nMiles Clements\nInvestor\nJosh Miller\nInvestor\nAndrew Mason\nInvestor\nJorn van Dijk\nInvestor\nImmad Akhund\nInvestor\nJob van der Voort\nInvestor\nPatrick Collison\nInvestor\nIlkka Paananen\nInvestor\nChristina Cacioppo\nInvestor\nGuillermo Rauch\nInvestor\nAnthony Guo\nInvestor\nStewart Butterfield\nInvestor\nDick Costolo\nInvestor\nClaire Hughes Johnson\nInvestor\nAkash Garg\nInvestor\n## Teams",
        "title": "Linear - The Org",
        "url": "https://theorg.com/org/linear",
        "date": "2026-02-07",
        "last_updated": "2026-05-19"
      },
      {
        "snippet": "The Leadership Team at Linear is responsible for setting the strategic vision and direction of the company, driving innovation in software development management, and fostering a culture of efficiency and collaboration.\nThis team, comprised of the co-founders, ensures alignment across all departments, promotes growth initiatives, and reinforces Linear's commitment to empowering high-performing teams.\nNo jobs in this team",
        "title": "Leadership Team - Linear - The Org",
        "url": "https://theorg.com/org/linear/teams/leadership-team",
        "date": "2023-05-25",
        "last_updated": "2025-10-20"
      },
      {
        "snippet": "",
        "title": "The Story of Linear as told by its CTO - The Pragmatic Engineer",
        "url": "https://newsletter.pragmaticengineer.com/p/linear",
        "date": "2022-11-22",
        "last_updated": "2026-05-16"
      },
      {
        "snippet": "## 3 Team Members\nLinear has 3 executives.\nLinear's current Founder, Chief Executive Officer is Karri Saarinen.\n|Name|Work History|Title|Status|\n|--|--|--|--|\n|Karri Saarinen|Airbnb, Coinbase, Kippt, Grey Area, Kisko Labs, Flowdock, ArcticStartup, and Finnish Defence Forces|Founder, Chief Executive Officer|Current|\n...\n|Name|Karri Saarinen|Subscribe to see more|Subscribe to see more|\n|--|--|--|--|\n|Work History|Airbnb, Coinbase, Kippt, Grey Area, Kisko Labs, Flowdock, ArcticStartup, and Finnish Defence Forces|\n|Title|Founder, Chief Executive Officer|Subscribe to see more|Subscribe to see more|\n|Status|Current|Subscribe to see more|Subscribe to see more|",
        "title": "Linear Management Team",
        "url": "https://www.cbinsights.com/company/linear-1/people",
        "date": "2023-09-14",
        "last_updated": "2025-02-13"
      },
      {
        "snippet": "# Welcoming Cristina Cordova to Linear\nKarri Saarinen\nI’m excited to share that Cristina Cordova has joined Linear as Chief Operating Officer to help us shape the company and lead our go-to-market efforts.\n...\nCristina brings a wealth of experience to Linear having previously scaled products and teams at Stripe and Notion.\nAt Notion, Cristina served as the Head of Platform & Partnerships managing the launch of the company’s API and building various business development and product growth teams.\nShe previously spent more than seven years at Stripe, where she led a business unit and built the partnerships team from the ground up.\nShe joined Stripe as one of the first employees and helped to grow the company to nearly 3000 people.\nMost recently, Cristina was a Partner at First Round and an investor and advisor to companies such as Canva, AtoB and Meter (most of which are building with Linear).\n...\nKarri Saarinen",
        "title": "Welcoming Cristina Cordova to Linear",
        "url": "https://linear.app/now/welcoming-cristina-cordova-to-linear",
        "date": "2023-05-23",
        "last_updated": "2026-03-05"
      },
      {
        "snippet": "",
        "title": "Linear Business Breakdown & Founding Story - Contrary Research",
        "url": "https://research.contrary.com/company/linear",
        "date": "2025-05-02",
        "last_updated": "2026-05-21"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

### advanced-deep

A frontier-model configuration for high-quality, multi-step research when latency budget is generous.

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()


  def get_output_text(response) -> str:
      return "".join(
          content.text
          for item in response.output or []
          if getattr(item, "type", None) == "message"
          for content in getattr(item, "content", None) or []
          if getattr(content, "type", None) == "output_text"
      )


  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      reasoning={"effort": "medium"},
      tools=[
          {
              "type": "people_search",
              "max_tokens": 10000,
              "max_tokens_per_page": 1000,
          },
          {
              "type": "web_search",
              "max_tokens": 10000,
              "max_tokens_per_page": 1000,
          },
          {"type": "fetch_url"},
      ],
      max_steps=10,
      input="Identify the current CEO of Notion, Linear, and Figma, and summarize each one's professional background.",
  )

  print(get_output_text(response))
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    reasoning: { effort: 'medium' },
    tools: [
      {
        type: 'people_search',
        max_tokens: 10000,
        max_tokens_per_page: 1000,
      },
      {
        type: 'web_search',
        max_tokens: 10000,
        max_tokens_per_page: 1000,
      },
      { type: 'fetch_url' },
    ],
    max_steps: 10,
    input: 'Identify the current CEO of Notion, Linear, and Figma, and summarize each one\'s professional background.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "reasoning": {"effort": "medium"},
      "tools": [
        {
          "type": "people_search",
          "max_tokens": 10000,
          "max_tokens_per_page": 1000
        },
        {
          "type": "web_search",
          "max_tokens": 10000,
          "max_tokens_per_page": 1000
        },
        {"type": "fetch_url"}
      ],
      "max_steps": 10,
      "input": "Identify the current CEO of Notion, Linear, and Figma, and summarize each one\u0027s professional background."
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "5b5af173-6ae5-4cad-bddd-b1f64c4f71aa",
    "results": [
      {
        "snippet": "",
        "title": "Tools for the Future: Your best semester with Notion, Arc and Figma",
        "url": "https://www.youtube.com/watch?v=UuOI99qN9PU",
        "date": "2024-09-28",
        "last_updated": "2026-05-16"
      },
      {
        "snippet": "",
        "title": "The Figma vs. Notion Playbook: Interview Secrets, & Comp Data ...",
        "url": "https://superinterviews.substack.com/p/the-figma-vs-notion-playbook-interview",
        "date": "2025-10-30",
        "last_updated": "2026-05-03"
      },
      {
        "snippet": "And they are doing so in incredibly unique ways:\n1. **No product managers, just a head of product.** PM duties are distributed across engineering and design.\n...\nOne.\nWe hired Nan Yu a little over a year ago when we were about 25 people.\nHe is Head of Product and currently the only one carrying a “PM” title.\nThe reason I phrase it this way is that we have other roles that also contribute to what is traditionally considered part of the PM role.\n...\nSince we don’t have any PMs other than our Head of Product, the project lead is never a PM.\n...\nI, along with my co-founders Jori Lallo and Tuomas Artman and our Head of Product, each lead or sit in each project meeting acting as a sponsor to give feedback and direction as needed.\nOne of us is ultimately responsible for the outcome.\n...\nYes, product, engineering, and design are all part of the product team.\nProduct and design report to me (CEO).\nWe have engineering managers, but engineering ultimately reports up to my co-founders: Tuomas for infrastructure and Europe engineering, and Jori for U.S. engineering.\n...\nOne of the unique aspects to Linear is that we expect the project team to be the PM.",
        "title": "How Linear builds product - Lenny's Newsletter",
        "url": "https://www.lennysnewsletter.com/p/how-linear-builds-product",
        "date": "2023-09-26",
        "last_updated": "2026-05-11"
      },
      {
        "snippet": "",
        "title": "An inside look at how Figma builds product | Yuhki Yamashita (CPO of Figma)",
        "url": "https://www.youtube.com/watch?v=NepFo4zXyK4",
        "date": "2023-01-08",
        "last_updated": "2026-02-08"
      },
      {
        "snippet": "",
        "title": "Make an Org Chart You Want to Ship — Advice from Linear on How ...",
        "url": "https://review.firstround.com/make-an-org-chart-you-want-to-ship-advice-from-linear-on-how-heirloom-tomatoes-should-inspire-team-design/",
        "date": "2024-08-07",
        "last_updated": "2026-05-20"
      },
      {
        "snippet": "",
        "title": "Config 2024: The heirloom tomato org chart (Nan Yu, Head of Product, Linear) | Figma",
        "url": "https://www.youtube.com/watch?v=I4vvBidQcck",
        "date": "2024-06-30",
        "last_updated": "2025-08-23"
      },
      {
        "snippet": "### Open Role\nChief Product Officer\nProduct\n0 reports\n### Open Role\n...\n### Product\n**250** employees\ncpo\nOwns product vision, UX, and roadmap for the Notion workspace.\n...\nstacks up\nCompared with peers like Airtable, Figma (pre-acquisition), and Linear, Notion retains a more centralized founder-led model with AI elevated early.\nAirtable and Asana show more mature GTM and COO layers, while Notion remains closer to a product-centric structure optimized for innovation velocity.\n...\nFunctional leaders across product, engineering, AI research, GTM, finance, people, and security report directly to the CEO.",
        "title": "Notion Labs, Inc. Organizational Structure - Creately",
        "url": "https://creately.com/org-chart/major-startups/notion/",
        "date": "2026-04-01",
        "last_updated": "2026-05-15"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

### ultra-deep

Maximum-depth configuration with the largest token budgets, the highest step count, and `xltokens` per-tool settings. Best for exhaustive investigations.

<Warning>
  `openai/gpt-5.6-sol` with high reasoning and streaming may be flaky upstream. If requests hang, switch to `medium` effort or use a non-streaming call.
</Warning>

<CodeGroup>
  ```python Python theme={null}
  from perplexity import Perplexity

  client = Perplexity()


  def get_output_text(response) -> str:
      return "".join(
          content.text
          for item in response.output or []
          if getattr(item, "type", None) == "message"
          for content in getattr(item, "content", None) or []
          if getattr(content, "type", None) == "output_text"
      )


  response = client.responses.create(
      model="openai/gpt-5.6-sol",
      reasoning={"effort": "high"},
      tools=[
          {
              "type": "people_search",
              "max_tokens": 20000,
              "max_tokens_per_page": 2000,
          },
          {
              "type": "web_search",
              "max_tokens": 20000,
              "max_tokens_per_page": 2000,
          },
          {"type": "fetch_url"},
      ],
      max_steps=50,
      max_output_tokens=32000,
      input="Build a complete leadership map of Anthropic, including the executive team and direct reports to each VP, with prior employment history.",
  )

  print(get_output_text(response))
  ```

  ```typescript TypeScript theme={null}
  import Perplexity from '@perplexity-ai/perplexity_ai';

  const client = new Perplexity();

  const response = await client.responses.create({
    model: 'openai/gpt-5.6-sol',
    reasoning: { effort: 'high' },
    tools: [
      {
        type: 'people_search',
        max_tokens: 20000,
        max_tokens_per_page: 2000,
      },
      {
        type: 'web_search',
        max_tokens: 20000,
        max_tokens_per_page: 2000,
      },
      { type: 'fetch_url' },
    ],
    max_steps: 50,
    max_output_tokens: 32000,
    input: 'Build a complete leadership map of Anthropic, including the executive team and direct reports to each VP, with prior employment history.',
  });

  console.log(response.output_text);
  ```

  ```bash cURL theme={null}
  curl -X POST "https://api.perplexity.ai/v1/agent" \
    -H "Authorization: Bearer $PERPLEXITY_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "openai/gpt-5.6-sol",
      "reasoning": {"effort": "high"},
      "tools": [
        {
          "type": "people_search",
          "max_tokens": 20000,
          "max_tokens_per_page": 2000
        },
        {
          "type": "web_search",
          "max_tokens": 20000,
          "max_tokens_per_page": 2000
        },
        {"type": "fetch_url"}
      ],
      "max_steps": 50,
      "max_output_tokens": 32000,
      "input": "Build a complete leadership map of Anthropic, including the executive team and direct reports to each VP, with prior employment history."
    }'
  ```
</CodeGroup>

<Accordion title="Response">
  ```json theme={null}
  {
    "id": "276b823b-9651-4c63-87c3-6be6f3b51a99",
    "results": [
      {
        "snippet": "",
        "title": "List of Anthropic Executives & Org Chart - Clay",
        "url": "https://www.clay.com/dossier/anthropic-executives",
        "date": null,
        "last_updated": "2026-05-20"
      },
      {
        "snippet": "This Org Chart shows 64 people with power at Anthropic, including management, board directors and members of an independent oversight body.\nThe AI company has several OpenAI alumni across various departments, a rival organization that all seven Anthropic co-founders left in 2020.\nDownload CSV\n...\n### Board of DirectorsorDaniela Amodei\nAnthropic\nDario Amodei\nAnthropic\nYasmin Razavi\nSpark Capital\nJay Kreps\nCEO and co-founder, Confluent\nReed Hastings\nNetflix co-founder\nVas Narasimhan\nCEO of Novartis\nChris Liddell\nFormer CFO at Microsoft, White House deputy chief of staff\nJason Matheny\nLong-Term Benefit Trust CEO of the RAND Corporation\nKanika Bahl\nLong-Term Benefit Trust CEO & President of Evidence Action\nNeil Buddy Shah (Chair)\nLong-Term Benefit Trust CEO of the Clinton Health Access Initiative\nPaul Christiano\nLong-Term Benefit Trust Founder of the Alignment Research Center\nZach Robinson\nLong-Term Benefit Trust Interim CEO of Effective Ventures US",
        "title": "Anthropic Org Chart & Company Structure Hierarchy - The Information",
        "url": "https://www.theinformation.com/org-charts/anthropic",
        "date": null,
        "last_updated": "2026-05-16"
      },
      {
        "snippet": "Anthropic is an AI safety and research company that’s working to build reliable, interpretable, and steerable AI systems.\n...\nHeadquarters\nSan Francisco, United States\n...\n## Org chart\nDario Amodei\nCo-Founder & CEO\nCollapse\nDaniela Amodei\nPresident And Co-founder\nMike Krieger\nChief Product Officer\nKrishna Rao\nChief Financial Officer\nHannah Pritchett\nHead Of People\nAndrew H.\nChief Of Staff\nJack Clark\nCo-Founder\nRahul Patil\nCTO\nPaul Smith\nChief Commercial Officer\nJeffrey Bleich\nGeneral Counsel\nMichael Sellitto\nHead Of Global Affairs\nAndrej Karpathy\nPre-training Team\n### Board & advisors\nMatt Murphy\nBoard Observer\nReed Hastings\nBoard Member\n## Teams",
        "title": "Anthropic | The Org",
        "url": "https://theorg.com/org/anthropic",
        "date": "2025-12-06",
        "last_updated": "2026-05-21"
      },
      {
        "snippet": "Anthropic, the company behind the Claude family of A.I. models, has moved with remarkable speed since its founding in 2021.\nIn recent months, its high-velocity growth has been accompanied by a wave of high-profile hires, including Rahul Patil as chief technology officer (joining from Stripe) and Vitaly Gudanets as chief information security officer (joining from Netflix).\n...\nAnthropic was founded by seven former OpenAI employees.\nEstablished as a public benefit corporation, it has since assembled a leadership roster drawn from companies like Netflix, Instagram and Stripe.\n### Here are 11 notable executives leading Anthropic today, along with other key figures:\n### Dario Amodei, CEO & Co-founder\nDario Amodei co-founded Anthropic in February 2021 after serving as a vice president of research at OpenAI.\nBefore that, he worked as a senior research scientist at Google.\nHis work has been central to advancing techniques that use human feedback to train A.I. systems.\nAmodei left OpenAI with six colleagues over disagreements around A.I. safety, a split that ultimately led to Anthropic’s creation.\nIn November 2023, he rejected a proposal for OpenAI and Anthropic to merge, signaling the company’s commitment to an independent research agenda.\n### Daniela Amodei, President & Co-founder\nDaniela Amodei is Dario Amodei’s sister.\nShe was formerly vice president of safety and policy at OpenAI, where she focused on risk mitigation and operational oversight.\nBefore entering the A.I. sector, she transitioned from a path in campaign politics to leadership roles in tech, ultimately joining Stripe as a risk manager.\nAt Anthropic, she oversees core operations, with senior leaders, including CTO Rahul Patil and chief architect Sam McCandlish, reporting directly to her.\n### Mike Krieger, Chief Product Officer\nMike Krieger is one of the two co-founders of Instagram.\nHe served as the platform’s chief technology officer through its explosive growth.\nAfter leaving in 2018, he and the other Instagram co-founder, Kevin Systrom, launched a personalized news app called Artifact in 2021.\nArtifact was sold to Yahoo in April 2024, and Krieger joined Anthropic the following month.\n### Rahul Patil, Chief Technology Officer\nRahul Patil joined Anthropic as chief technology officer in October, stepping into the role previously held by chief architect Sam McCandlish.\nPatil comes from Stripe, where he also served as CTO, and brings deep experience leading engineering teams at companies including Microsoft, AWS and Oracle.\nHe now oversees Anthropic’s full engineering organization and reports directly to Daniela Amodei.\n### Jared Kaplan, Chief Science Officer & Co-founder\nJared Kaplan, a theoretical physicist and professor at Johns Hopkins University, co-founded Anthropic after previously consulting on research at OpenAI.\nHis academic work spans quantum field theory and machine learning, grounding his leadership of Anthropic’s scientific direction.\nKaplan guides the company’s long-term research agenda and oversees foundational model development alongside other senior technical leaders.\n### Jan Leike, Alignment Science Lead\nJan Leike joined Anthropic after serving as co-lead of OpenAI’s superalignment team, where he focused on ensuring advanced A.I. systems remain controllable and aligned with human goals.\nHe now leads Anthropic’s alignment science efforts, reporting to Jared Kaplan.\n...\n### Sam McCandlish, Chief Architect & Co-founder\nSam McCandlish holds a Ph.D. in theoretical physics from Stanford, and his scholarly work has garnered over 100,000 citations.\nHe is one of the seven former OpenAI employees who left to found Anthropic.\nAt Anthropic, McCandlish focuses on model training and large-scale systems development.\nHe previously served as the company’s chief technology officer before transitioning into his current role, reporting to Daniela Amodei.\n### Tom Brown, Chief Compute Officer & Co-founder\nTom Brown co-founded Anthropic after leading the research engineering team behind GPT-3 at OpenAI.\nA self-taught engineer, he played a pivotal role in building the modern era of large-scale compute systems.\nBrown now oversees Anthropic’s compute infrastructure, a task described by Y Combinator as “humanity’s largest infrastructure buildout ever.”\n### Vitaly Gudanets, Chief Information Security Officer\nVitaly Gudanets joined Anthropic as chief information security officer in September.\nHe previously held the same role at Netflix, where he oversaw security strategy during the company’s global expansion.\nIn addition to his position at Anthropic, Gudanets serves as an operating partner at Lightspeed Venture Partners, advising portfolio companies on cybersecurity and organizational resilience.\n### Jack Clark, Head of Policy & Co-founder\nJack Clark co-founded Anthropic after serving as policy director at OpenAI, where he helped shape the organization’s early approach to A.I. governance.\nBefore entering the policy side of the industry, Clark was a technology journalist at outlets including Bloomberg and authored the long-running A.I. newsletter *Import AI*.\nClark leads Anthropic’s global policy efforts and represents the company in international discussions on safety and regulation.\nHe currently serves as an expert for the Global Partnership on AI under the OECD.\n### Krishna Rao, Chief Financial Officer\nKrishna Rao joined Anthropic after holding senior financial and strategy roles across several high-growth companies, including serving as global head of corporate and business development at Airbnb and as CFO at both Fanatics Collectibles and the healthcare payments platform Cedar.\nAt Anthropic, Rao oversees the company’s financial strategy and long-term planning.\n...\n### Anthropic’s current board members and other key figures\n- Dario Amodei\n- Daniela Amodei\n- Yasmin Razavi: General partner at Spark Capital, which led Anthropic’s $450 million Series C in 2023\n- Jay Kreps: CEO of the real-time data streaming company Confluent\n- Reed Hastings: CEO of Netflix\nAnthropic has also established the Long-Term Benefit Trust (LTBT), a separate stockholder-elected board designed to align the company’s governance with its mission of “developing and maintaining advanced A.I. for the long-term benefit of humanity.”\nLTBT members include:\n- Neil Buddy Shah: CEO of the Clinton Health Access Initiative\n- Kanika Bahl: CEO of the evidence-based charity Evidence Action\n- Zach Robinson: CEO of the Centre for Effective Altruism and Effective Ventures Foundation USA.\n- Richard Fontaine: CEO of the Center for a New American Security",
        "title": "11 Executives Driving Anthropic's Meteoric Rise in the A.I. Boom",
        "url": "https://observer.com/2025/11/11-executives-driving-anthropics-meteoric-rise-in-the-a-i-boom/",
        "date": "2025-11-11",
        "last_updated": "2026-04-16"
      },
      {
        "snippet": "",
        "title": "Anthropic - Wikipedia",
        "url": "https://en.wikipedia.org/wiki/Anthropic",
        "date": "2006-08-01",
        "last_updated": "2026-05-21"
      },
      {
        "snippet": "Anthropic began restructuring its leadership and organization in early 2026 as it prepares for a potential IPO.\n...\nHeadcount has also surged, with roughly 2,300 employees at the end of last year, more than double its size just months earlier.\n...\nA key part of this restructuring is the creation of Anthropic Labs in January, a research and development unit focused on incubating experimental products at the frontier of Claude’s capabilities.\n...\nThese structural changes are closely tied to a broader leadership reshuffle, including the promotion of former chief product officer Mike Krieger to co-lead Anthropic Labs.\n...\n### Mike Krieger and Ben Mann co-lead Anthropic Labs\nKrieger, Anthropic’s former chief product officer and a co-founder of Instagram, transitioned to co-lead Anthropic Labs at its launch earlier this year.\nAt Instagram, he served as chief technology officer, and later co-founded the news app Artifact, which he sold to Yahoo in 2024.\nA native of Brazil, Krieger is a Stanford University alumnus.\nBen Mann, an Anthropic co-founder, previously helped architect GPT-3 at OpenAI and worked as a software engineer at Google.\nBefore moving to Labs, he served as Anthropic’s lead product engineer, focusing on A.I. alignment and harm mitigation.\nMann graduated from Columbia University.\nAt Anthropic Labs, Krieger and Mann oversee a range of high-stakes initiatives, including the controlled rollout and governance of Claude Mythos, the company’s most advanced model.\n...\n### Ami Vora replaces Mike Krieger as CPO\nFollowing Krieger’s move to Anthropic Labs, Ami Vora has taken on the role of chief product officer.\nShe joined the company in December 2025 as head of product and was quickly promoted.\nVora previously spent 15 years at Meta, where she held leadership roles, including vice president of product at Facebook and vice president of product and design at WhatsApp.\nShe began her career at Microsoft and remains on the board of cloud monitoring platform Datadog.\nAs CPO, Vora works closely with chief technology officer Rahul Patil to scale Claude beyond experimentation and expand Anthropic’s market presence.\n### Rahul Patil stays on as CTO, with an expanded role\nAnthropic’s broader leadership bench remains deep, with all seven co-founders still at the company.\nRahul Patil, who became CTO in October, succeeded Sam McCandlish, now chief architect.\nPatil previously served as CTO of Stripe and has led engineering teams at Microsoft, AWS and Oracle.\nNow working in close coordination with Vora, Patil is focused on bridging the gap between technical research and production-ready products.\n...\n### Other executives shaping Anthropic’s future\n- **Dario Amodei, CEO and co-founder: ** Dario Amodei previously served as vice president of research at OpenAI.\nHe founded Anthropic in 2021 with his sister, Daniela, and other former OpenAI colleagues.\n- **Daniela Amodei, president and co-founder: ** Daniela Amodei, who previously served as vice president of safety and policy at OpenAI, oversees Anthropic’s core operations, including chief technology officer Rahul Patil and chief architect Sam McCandlish.\n- **Jared Kaplan, chief science officer and co-founder: ** Anthropic co-founder and former OpenAI researcher Jared Kaplan serves as chief science officer.\nSince 2024, he has also served as the company’s responsible scaling officer, helping guide safety-related decisions.\n- **Jan Leike, alignment science lead: ** Jan Leike, who co-led OpenAI’s superalignment team, has served as Anthropic’s alignment science lead since 2024.\n- **Sam McCandlish, chief architect and co-founder: ** Another former OpenAI employee, Sam McCandlish focuses on model training and large-scale systems development.\nHe previously served as Anthropic’s CTO.\n- **Tom Brown, chief compute officer and co-founder: ** Former OpenAI GPT-3 researcher Tom Brown oversees Anthropic’s compute infrastructure.\n- **Vitaly Gudanets, CISO: ** Vitaly Gudanets has served as Anthropic’s chief information security officer since September.\nHe previously led security efforts at Netflix.\n- **Jack Clark, head of policy and co-founder: ** A former OpenAI policy director and technology journalist, Jack Clark leads Anthropic’s policy work.\n- **Krishna Rao, CFO: ** Krishna Rao joined Anthropic as chief financial officer in 2024 after previously leading finance at Airbnb.\n- **Christopher Olah, interpretability research lead and co-founder: ** Christopher Olah, a former interpretability lead at OpenAI, heads Anthropic’s interpretability research, focusing on model transparency and A.I. safety.\n### Anthropic’s board and trust\nIn February, Anthropic appointed Chris Liddell, a former deputy White House chief of staff and former CFO at Microsoft and General Motors, to its board of directors.\nDaniela Amodei said Liddell has “a track record of helping organizations get [technology, public service and governance] right when the stakes are highest.”\nThe rest of the board remains unchanged, including Dario Amodei, Daniela Amodei, Yasmin Razavi, Jay Kreps, Reed Hastings and Chris Liddell.\nThe Long-Term Benefit Trust recently removed Kanika Bahl and Zach Robinson and added Mariano-Florentino Cuéllar; Neil Buddy Shah remains on the trust board.",
        "title": "14 Executives Driving Anthropic's Future After Its Labs Expansion",
        "url": "https://observer.com/2026/04/anthropic-top-executives-after-labs-launch/",
        "date": "2026-04-20",
        "last_updated": "2026-05-19"
      },
      {
        "snippet": "Leadership Team\n7 people · 0 jobs\nThe Leadership Team at Anthropic guides the strategic direction of the company while ensuring a commitment to AI safety and ethics.\nComprised of co-founders and executives with diverse expertise in technology, finance, and security, this team focuses on fostering a collaborative environment, driving innovative research initiatives, and overseeing the development of reliable and interpretable AI systems that align with the company's vision for responsible AI deployment.\n...\nNo jobs in this team",
        "title": "Leadership Team - Anthropic",
        "url": "https://theorg.com/org/anthropic/teams/leadership-team-1",
        "date": "2023-01-24",
        "last_updated": "2026-05-13"
      },
      {
        "snippet": "Anthropic is a collaborative team of researchers, engineers, policy experts, business leaders and operators, who bring our experience from many different domains to our work.\n...\nWe’re a team of researchers, engineers, policy experts and operational leaders, with experience spanning a variety of disciplines, all working together to build reliable and understandable AI systems.\n...\n### Operations\nOur people, finance, legal, and recruiting teams are the human engines that make Anthropic go.\nWe’ve had previous careers at NASA, startups, and the armed forces and our diverse experiences help make Anthropic a great place to work (and we love plants!).\n...\nAnthropic is a Public Benefit Corporation, whose purpose is the responsible development and maintenance of advanced AI for the long-term benefit of humanity.\nOur Board of Directors is elected by stockholders and our Long-Term Benefit Trust, as explained here.\nCurrent members of the Board and the Long-Term Benefit Trust (LTBT) are listed below.\n**Anthropic Board of Directors**\nDario Amodei, Daniela Amodei, Yasmin Razavi, Jay Kreps, Reed Hastings, Chris Liddell, and Vas Narasimhan.\n**LTBT Trustees**\nNeil Buddy Shah, Richard Fontaine, and Mariano-Florentino Cuéllar.",
        "title": "Company \\ Anthropic",
        "url": "https://www.anthropic.com/company",
        "date": "2023-11-14",
        "last_updated": "2026-05-21"
      },
      {
        "snippet": "## Who's running this\n7 public leadership roles from company pages, announcements, and reliable news signals.\nUse this as a current operating-model reference, not an SEC filing table.\n### Dario Amodei\nChief Executive Officer & Co-Founder\nExecutive\n10 reports\n### Daniela Amodei\nPresident & Co-Founder\nExecutive\n4 reports\n### Open Role\nHead of Research\nResearch\n0 reports\n### Open Role\nChief Product Officer\nProduct\n0 reports\n### Open Role\nChief Technology / Engineering Lead\nEngineering\n1 reports\n### Open Role\nHead of Policy\nPolicy\n0 reports\n### Open Role\nChief Operating Officer\nOperations\n3 reports\nThe businesses\n...\n3 divisions report into the group CEO.\nTile size scales with estimated headcount.\n### Research\n**600** employees\np3\nFrontier AI research and safety science.\n### Product & Engineering\n**500** employees\np4\nProductization of research into Claude and platform offerings.\n### Operations\n**400** employees\np7\nPeople, finance, legal, and internal operations.\n...\nNo recent leadership changes publicly disclosed.\n...\n3 directors.\n1 of 3 independent (33%).\n...\n### Dario Amodei\nInside\nCEO, Anthropic\n### Daniela Amodei\nInside\nPresident, Anthropic\n### Reed Hastings\nIndependent\nCo-Founder, Netflix\n...\n### Who leads Anthropic?\nAnthropic is led by CEO and co-founder Dario Amodei, with Daniela Amodei serving as President.\n...\nAnthropic builds reliable, interpretable, and steerable AI systems, including the Claude family of models, with a strong emphasis on safety.\n### What type of organizational structure does Anthropic use?\nAnthropic uses a hybrid structure combining founder-led research control with functional product, policy, and operations teams.\n### Who reports directly to Anthropic's CEO?\nResearch, product, engineering, and policy leaders report directly to the CEO.",
        "title": "Anthropic PBC Organizational Structure - Creately",
        "url": "https://creately.com/org-chart/major-startups/anthropic/",
        "date": "2026-04-01",
        "last_updated": "2026-05-15"
      },
      {
        "snippet": "Organizational Chart of Anthropic\nOrganigramme de Anthropic\nwww.anthropic.com\na24 dirigeants\n+1 650 493 7900\n...\nCEO & Director\nDario Amodei\n...\nJay Kreps\n...\nYasmin Razavi\n...\nKrishna Rao\n...\nAnthropic a 24 dirigeants\nAnthropic\n...\nListe dirigeants en Excel\n• Anthropic org chart\nL'organigramme en PDF\n• Anthropic org chart\n{title}\n...\nPour chacun des 1 304 900 dirigeants,\ndécouvrir ses fonctions exactes\net sa biographie.\n...\nPour toute assistance, vous pouvez nous contacter à\n[email protected]",
        "title": "Anthropic - Organigramme + Equipe Dirigeante",
        "url": "https://www.theofficialboard.fr/organigramme/anthropic",
        "date": null,
        "last_updated": "2025-05-28"
      }
    ],
    "server_time": null
  }
  ```
</Accordion>

## Parameters

| Parameter | Type | Required | Description |
| - | - | - | - |
| `type` | string | Yes | Must be `"people_search"`. |
| `max_tokens` | integer | No | Maximum total tokens for people-search context when using explicit token budgets. |
| `max_tokens_per_page` | integer | No | Maximum tokens extracted per result page when using explicit token budgets. |

## Response Shape

When `people_search` runs, the response can include a `people_search_results` output item before the final assistant message. The envelope contains the agent's generated `queries` and a `results` array whose entries share the same shape as `search_results` (id, url, title, snippet, source, last\_updated). The final `usage` object includes token counts, cost details, and `tool_calls_details.search_people.invocation` when tool-call usage is reported.

```json theme={null}
{
  "output": [
    {
      "type": "people_search_results",
      "queries": ["head of platform engineering Notion"],
      "results": [
        {
          "id": 1,
          "url": "https://example.com/profile",
          "title": "Example professional profile",
          "snippet": "A short snippet describing the professional result.",
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
          "text": "The answer generated from people-search results."
        }
      ]
    }
  ],
  "usage": {
    "tool_calls_details": {
      "search_people": {
        "invocation": 1
      }
    }
  }
}
```

## Pricing

Each invocation of the `people_search` tool is billed at **\$5 per 1,000 tool invocations**. See the [Pricing](/docs/getting-started/pricing) page for full details.

## Limits / Quotas

People Search runs inside Agent API requests and is subject to your Agent API rate limits. See [Rate Limits & Usage Tiers](/docs/admin/rate-limits-usage-tiers#agent-api-rate-limits) for tier-based request limits.

| Limit | How it applies |
| - | - |
| **Rate limits** | Counts against your Agent API request rate limits. No separate `people_search` tool-call quotas apply. |

## Next Steps

<CardGroup cols={2}>
  <Card title="Web Search" icon="world-search" href="/docs/agent-api/tools/web-search">
    Search the web for source-grounded context.
  </Card>

  <Card title="Fetch URL Content" icon="file-text" href="/docs/agent-api/tools/fetch-url-content">
    Fetch full content from known URLs.
  </Card>

  <Card title="Finance Search" icon="chart-line" href="/docs/agent-api/tools/finance-search">
    Retrieve structured financial and market data.
  </Card>

  <Card title="Agent API Quickstart" icon="rocket" href="/docs/agent-api/quickstart">
    Get started with the Agent API.
  </Card>
</CardGroup>
