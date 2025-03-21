import userAvatar from '@app/assets/bgimages/avatar-user.svg';
import orb from '@app/assets/bgimages/orb.svg';
import config from '@app/config';
import { Flex, FlexItem, FormSelect, FormSelectOption, Grid, GridItem, StackItem, Text, TextContent, TextVariants } from "@patternfly/react-core";
import { t } from "i18next";
import React, { forwardRef, useImperativeHandle, Ref, useRef } from 'react';
import Markdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { dracula } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Answer, Message, MessageHistory, Query, Sources, Models, Source } from './classes';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { version } from 'html-webpack-plugin';


type MarkdownRendererProps = {
  children: string;
};


interface ChatAnswerProps {
}

export interface ChatAnswerRef {
  sendQuery: (query: Query) => void;
  resetMessageHistory: () => void;
  changeCollectionOrVersion: (selectedCollection, selectedVersion) => void;
}

const ChatAnswer = forwardRef((props: ChatAnswerProps, ref: Ref<ChatAnswerRef>) => {
  // Models
  const [llms, setLlms] = React.useState<Models[]>([]); // The list of models
  const [selectedLLM, setSelectedLlm] = React.useState<string>(''); // The selected model

  // Websocket
  const wsUrl = config.backend_api_url.replace(/http/, 'ws').replace(/\/api$/, '/ws'); // WebSocket URL
  const connection = React.useRef<WebSocket | null>(null); // WebSocket connection
  const uuid = Math.floor(Math.random() * 1000000000); // Generate a random number between 0 and 999999999

  // Chat elements
  const [answerText, setAnswerText] = React.useState<Answer>(new Answer([''])); // The answer text
  const [answerSources, setAnswerSources] = React.useState<Sources>(new Sources([])); // Array of sources for the answer
  const [messageHistory, setMessageHistory] = React.useState<MessageHistory>(
    new MessageHistory([
      new Message(new Answer([t('chat.content.greeting')]))
    ])
  ); // The message history
  const chatBotAnswer = document.getElementById('chatBotAnswer'); // The chat bot answer element

  // Stopwatch and timer#
  const startTime = useRef<number | null>(null);
  const [tokens, setTokens] = React.useState<number>(0);
  const [ttft, setTtft] = React.useState<number>(0);
  const [tps, setTps] = React.useState<number>(0);

  /**
     * Renders markdown content with syntax highlighting for code blocks.
     * 
     * @param markdown - The markdown content to render.
     * @returns The rendered markdown content.
     */
  const MarkdownRenderer = ({ children: markdown }: MarkdownRendererProps) => {
    return (
      <Markdown className='chat-question-text'
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');

            return !inline && match ? (
              <SyntaxHighlighter style={dracula} PreTag="div" language={match[1]} {...props}>
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code className='chat-question-text' {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {markdown}
      </Markdown>
    );
  }

  // Open a WebSocket connection and listen for messages
  React.useEffect(() => {
    const ws = new WebSocket(wsUrl + '/query/' + uuid) || {};

    ws.onopen = () => {
      console.log('opened ws connection')
    }
    ws.onclose = (e) => {
      console.log('close ws connection: ', e.code, e.reason)
    }

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data['type'] === 'token') {
        setTokens((prevTokens) => {
          const newTokens = prevTokens + 1;
          if (newTokens === 1) {
            if (startTime.current !== null) {
              setTtft((Date.now() - startTime.current) / 1000);
            }
          }
          if (startTime.current !== null) {
            setTps(newTokens / ((Date.now() - startTime.current) / 1000));
          }
          return newTokens;
        });
        setAnswerText(answerText => new Answer([...answerText.content, data['token']]));
        return;
      } else if (data['type'] === 'source') {
        setAnswerSources(answerSources => new Sources([...answerSources.content, new Source(data['source'], data['score'])]));
        return;
      }
    }

    connection.current = ws;

    // Clean up function
    return () => {
      if (connection.current) {
        connection.current.close();
        console.log('WebSocket connection closed');
      }
    };
  }, []);


  // Load available models at startup
  React.useEffect(() => {
    const fetchLLMs = async () => {
      const response = await fetch(`${config.backend_api_url}/llms`);
      const data = await response.json();
      setLlms(data);
      setSelectedLlm(data[0].name);
    }
    fetchLLMs();
  }
    , []);

  // Scroll to the bottom of the chat window when the answer changes
  React.useEffect(() => {
    if (chatBotAnswer) {
      chatBotAnswer.scrollTop = chatBotAnswer.scrollHeight;
    }
  }, [answerText, answerSources, messageHistory]);  // Dependency array


  /**
   * Sends the query text to the server via WebSocket.
   * Saves the previous response, sources, query, and message history, and create a new Message History from them.
   * Clears the query text, previous response, and previous sources.
   * If the query text is empty, sets the previous response to ['Please enter a query...'].
   */
  const sendQuery = (query: Query) => {
    if (connection.current?.readyState === WebSocket.OPEN) {
      const previousAnswer = new Message(new Answer(answerText.content)); // Save the previous response, needed because states are updated asynchronously
      const previousSources = new Message(new Sources(answerSources.content)); // Save the previous sources
      const previousQuery = new Message(new Query(query.content)); // Save the previous query
      const previousMessageHistory = new MessageHistory(messageHistory.content); // Save the previous message history
      setMessageHistory(new MessageHistory([...previousMessageHistory.content, previousAnswer, previousSources, previousQuery])); // Add the previous response to the message history
      setAnswerText(new Answer([])); // Clear the previous response
      setAnswerSources(new Sources([])); // Clear the previous sources
      setTokens(0);
      setTps(0);
      setTtft(0);
      // Put the query in a JSON object so that we can add other info later
      if (query.content !== "") {
        let data = {
          model: selectedLLM,
          query: query.content,
          collection: query.collection,
          collection_full_name: query.collectionFullName,
          version: query.selectedVersion,
          language: query.language
        };
        startTime.current = Date.now();
        connection.current?.send(JSON.stringify(data)); // Send the query to the server
      } else {
        setAnswerText(new Answer([t('chat.content.empty_query')]));
      }
    };
  }

  /**
   * Resets the message history, answer sources, and answer text.
   * If a selected collection is provided, it sets the message history with a message about the selected collection and version.
   * If no collection is selected, it sets the message history with a default greeting message.
   */
  const resetMessageHistory = () => {
    setMessageHistory(new MessageHistory([
      new Message(new Answer([t('chat.content.greeting')]))
    ]));
    setAnswerSources(new Sources([]));
    setAnswerText(new Answer(['']));
  };

  const changeCollectionOrVersion = (selectedCollection, selectedVersion) => {
    const previousAnswer = new Message( // Save the previous response, needed because states are updated asynchronously
      new Answer(answerText.content)
    );
    const previousSources = new Message( // Save the previous sources
      new Sources(answerSources.content)
    );
    const previousMessageHistory = new MessageHistory(messageHistory.content); // Save the previous message history
    if (selectedCollection.collection_full_name !== "None") {
      setMessageHistory(new MessageHistory(
        [...previousMessageHistory.content,
          previousAnswer,
          previousSources,
        new Message(new Answer(
          [t('chat.content.change_product_prompt_start') + ' **' + selectedCollection.collection_full_name + '** ' + t('chat.content.change_product_prompt_version') + ' **' + selectedVersion + '**.']
        ))
        ]
      ));
    } else {
      setMessageHistory(new MessageHistory(
        [...previousMessageHistory.content,
          previousAnswer,
          previousSources,
        new Message(new Answer(
          [t('chat.content.change_product_prompt_none')]
        ))
        ]
      ));
    }
    setAnswerText(new Answer([])); // Clear the previous response
    setAnswerSources(new Sources([])); // Clear the previous sources
  }

  useImperativeHandle(ref, () => ({
    sendQuery(query) {
      sendQuery(query);
    },
    resetMessageHistory() {
      resetMessageHistory();
    },
    changeCollectionOrVersion(selectedCollection, selectedVersion) {
      changeCollectionOrVersion(selectedCollection, selectedVersion);
    }
  }));

  const onChangeLlm = (_event: React.FormEvent<HTMLSelectElement>, value: string) => {
    setSelectedLlm(value);
  }

  /**
   * Converts a cosine similarity score to a percentage.
   *
   * The function clamps the input score to the range [0, 2] and then
   * converts it to a percentage where a score of 2 corresponds to 0%
   * and a score of 0 corresponds to 100%.
   *
   * @param score - The cosine similarity score to convert.
   * @returns The corresponding percentage value.
   */
  const cosineScoreToPercentage = (score: number): number => {

    const clampedScore = Math.max(0, Math.min(2, score));
    return Math.round((1 - clampedScore / 2) * 100);
}

  return (
    <Flex direction={{ default: 'column' }}>
      <FlexItem >
        <Flex direction={{ default: 'row' }} className='chat-llm-select'>
          <FormSelect
            value={selectedLLM}
            onChange={onChangeLlm}
            aria-label="FormSelect Input"
            ouiaId="BasicFormSelectCategory"
            className='chat-llm-select'
          >
            {llms && llms.map((llm, index) => (
              <FormSelectOption key={index} value={llm.name} label={llm.name} />
            ))}
          </FormSelect>
            <TextContent style={{ display: 'flex', alignItems: 'normal' }}>
          {ttft !== 0 && (            
              <Text className="token-metrics">{ttft.toFixed(2)}s tft,</Text>
          )}
          {tps !== 0 && (
              <Text className="token-metrics">{tps.toFixed(2)} t/s</Text>
          )}
          </TextContent>
        </Flex>
      </FlexItem>
      <FlexItem>
        <TextContent id='chatBotAnswer'>
          {/* Message History rendering */}
          {messageHistory.content.map((message: Message, index) => {
            const renderMessage = () => {
              if (message.content.content.length != 0) {
                if (message.content.type === "Query" && message.content.content != "") { // If the message is a query
                  return <Grid className='chat-item'>
                    <GridItem span={1} className='grid-item-orb'>
                      <img src={userAvatar} className='user-avatar' />
                    </GridItem>
                    <GridItem span={11}>
                      <Text component={TextVariants.p} className='chat-question-text'>{Array.isArray(message.content.content) ? message.content.content.join(' ') : message.content.content}</Text>
                    </GridItem>
                  </Grid>
                } else if (message.content.type === "Answer" && (message.content.content as string[]).join("") != "") { // If the message is a response
                  return <Grid className='chat-item'>
                    <GridItem span={1} className='grid-item-orb'>
                      <img src={orb} className='orb' />
                    </GridItem>
                    <GridItem span={11}>
                      <MarkdownRenderer>{(message.content.content as string[]).join("")}</MarkdownRenderer>
                    </GridItem>
                  </Grid>
                } else if (message.content.type === "Sources") { // If the message is a source
                  return <Grid className='chat-item'>
                    <GridItem span={1} className='grid-item-orb'>&nbsp;</GridItem>
                    <GridItem span={11}>
                      <Text component={TextVariants.p} className='chat-source-text'>{t('chat.content.references') + ": "}</Text>
                      {message.content && (message.content.content as Source[]).map((source, index) => {
                        const renderSource = () => {
                          if (source.content.startsWith('http')) {
                            return <Text component={TextVariants.p} className='chat-source-text'>
                              <a href={source.content} target="_blank" className='chat-source-link'>{source.content}</a>
                            </Text>
                          } else {
                            return <Text component={TextVariants.p} className='chat-source-text'>{source.content}</Text>
                          }
                        };
                        return (
                          <React.Fragment key={index}>
                            {renderSource()}
                          </React.Fragment>
                        );
                      })}
                    </GridItem>
                  </Grid>
                } else {
                  {/* If the message is of an unknown type */}
                  return;
                }
              } else {
                {/* If the message is empty */}
                return;
              }
            }

            return (
              <React.Fragment key={index}>
                {renderMessage()}
              </React.Fragment>
            );
          })}

          {/* New Answer rendering */}
          {answerText.content.join("") !== "" && (
            <div>
              <Grid className='chat-item'>
                <GridItem span={1} className='grid-item-orb'>
                  <img src={orb} className='orb' />
                </GridItem>
                <GridItem span={11}>
                  <MarkdownRenderer>{answerText.content.join("")}</MarkdownRenderer>
                </GridItem>
              </Grid>
              <Grid className='chat-item'>
                <GridItem span={1} className='grid-item-orb'>&nbsp;</GridItem>
                <GridItem span={11}>
                  <Text component={TextVariants.p} className='chat-source-text'>{answerSources.content.length != 0 && (t('chat.content.references') + ": ")}</Text>
                  {answerSources && answerSources.content.map((source, index) => {
                    const renderSource = () => {
                      if (source.content.startsWith('http')) {
                        return <Text component={TextVariants.p} className='chat-source-text'>
                          <a href={source.content} target="_blank" className='chat-source-link'>{source.content}</a> ({cosineScoreToPercentage(source.score)}% match)
                        </Text>
                      } else {
                        return <Text component={TextVariants.p} className='chat-source-text'>{source.content} ({cosineScoreToPercentage(source.score)}% match)</Text>
                      }
                    };
                    return (
                      <React.Fragment key={index}>
                        {renderSource()}
                      </React.Fragment>
                    );
                  })}

                </GridItem>
              </Grid>
            </div>
          )}
        </TextContent>
      </FlexItem>
    </Flex>
  );
})

export default ChatAnswer;