# Search

> Get ranked search results from Perplexity's continuously refreshed index with advanced filtering and customization options.



## OpenAPI

````yaml post /search
openapi: 3.0.2
info:
  title: Perplexity API
  description: Perplexity API
  version: 0.1.0
  x-mintlify:
    api:
      examples:
        defaults: required
servers:
  - url: https://api.perplexity.ai
security: []
paths:
  /search:
    post:
      summary: Search
      description: >-
        Get ranked search results from Perplexity's continuously refreshed index
        with advanced filtering and customization options.
      operationId: post_search
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/SearchRequest'
        required: true
      responses:
        '200':
          description: Successfully retrieved search results.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SearchResponse'
      security:
        - HTTPBearer: []
components:
  schemas:
    SearchRequest:
      title: SearchRequest
      required:
        - query
      type: object
      properties:
        query:
          title: Query
          oneOf:
            - type: string
              description: >-
                A search query. Can be a single query or a list of queries for
                multi-query search.
            - type: array
              items:
                type: string
              maxItems: 5
              description: >-
                An array of search queries for multi-query search. Maximum of 5
                queries per request.
          description: The search query or queries to execute.
          example: latest AI developments 2024
        max_results:
          title: Max Results
          type: integer
          description: The maximum number of search results to return.
          default: 10
          minimum: 1
          maximum: 20
        max_tokens:
          title: Max Tokens
          type: integer
          description: >-
            The maximum total number of tokens of webpage content returned
            across all search results. This sets the overall content budget for
            the search operation. Higher values return more content in the
            snippet fields. Use in combination with max_tokens_per_page to
            control content distribution.
          default: 25000
          minimum: 1
          maximum: 1000000
          example: 25000
        search_domain_filter:
          title: Search Domain Filter
          type: array
          items:
            type: string
          description: >-
            A list of domains/URLs to limit search results to. Maximum 20
            domains.
          maxItems: 20
          example:
            - science.org
            - pnas.org
            - cell.com
        max_tokens_per_page:
          title: Max Tokens Per Page
          type: integer
          description: >-
            Controls the maximum number of tokens retrieved from each webpage
            during search processing. Higher values provide more comprehensive
            content extraction but may increase processing time.
          default: 2048
          example: 2048
        country:
          title: Country
          type: string
          description: >-
            Country code to filter search results by geographic location (e.g.,
            'US', 'GB', 'DE').
          example: US
        search_recency_filter:
          title: Search Recency Filter
          type: string
          enum:
            - day
            - week
            - month
            - year
          description: >-
            Filters search results based on recency. Specify 'day' for results
            from the past 24 hours, 'week' for the past 7 days, 'month' for the
            past 30 days, or 'year' for the past 365 days.
          example: week
        search_after_date:
          title: Search After Date
          type: string
          description: >-
            Filters search results to only include content published after this
            date. Format should be %m/%d/%Y (e.g., '10/15/2025').
          example: 10/15/2025
        search_before_date:
          title: Search Before Date
          type: string
          description: >-
            Filters search results to only include content published before this
            date. Format should be %m/%d/%Y (e.g., '10/16/2025').
          example: 10/16/2025
    SearchResponse:
      title: SearchResponse
      type: object
      properties:
        results:
          title: Results
          type: array
          items:
            $ref: '#/components/schemas/SearchResult'
          description: An array of search results.
      required:
        - results
    SearchResult:
      title: SearchResult
      type: object
      properties:
        title:
          title: Title
          type: string
          description: The title of the search result.
        url:
          title: URL
          type: string
          format: uri
          description: The URL of the search result.
        snippet:
          title: Snippet
          type: string
          description: A brief excerpt or summary of the content.
        date:
          title: Date
          type: string
          format: date
          description: The date that the page was crawled and added to Perplexity's index.
          example: '2025-03-20'
        last_updated:
          title: Last Updated
          type: string
          format: date
          description: The date that the page was last updated in Perplexity's index.
          example: '2025-09-19'
      required:
        - title
        - url
        - snippet
        - date
        - last_updated
  securitySchemes:
    HTTPBearer:
      type: http
      scheme: bearer

````

---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.perplexity.ai/llms.txt