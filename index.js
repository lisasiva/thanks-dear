/* jslint node: true */
/* jslint esnext: true */

//===================================
// GLOBAL VARIABLES
//===================================

// Importing Node Modules
const Alexa = require('ask-sdk');
const AWS = require('aws-sdk');
AWS.config.update( {region: 'us-east-1'} );
const rp = require('request-promise');

// Configuring DynamoDB
const dbHelper = require('./helpers/dbHelper');
const docClient = new AWS.DynamoDB.DocumentClient();

// Reusable Messages
const APP_NAME = 'Mindful Couple';
const messages = {
    NOTIFY_MISSING_PERMISSIONS: 'Would it be okay if my developer followed up with 2 questions over email? If so, please update permissions in your Alexa app. Then, open ' + APP_NAME + ' again.',
    SURVEY: 'Before we stop, were you happy with this skill today?',
    ERROR: 'Uh oh. Something went wrong. You can restart this skill by saying <break time="0.05s"/> open ' + APP_NAME,
    WRONG_INVOCATION: 'Hmm. I wasn\'t expecting you to say that just then. <break time="0.05s"/> To hear what you can do with this skill, say <break time="0.05s"/> help. Or, if you\'re done, you can just say <break time="0.05s"/> stop.',
    FIRST_WELCOME: 'In the craziness of life, this skill helps you make time to show your partner how much you appreciate them. <break time="0.05s"/> To get a quick gratitude idea, say <break time="0.05s"/> give me an idea.',
    REPEAT_WELCOME: 'Welcome back to ' + APP_NAME + '! <break time="0.05s"/> To hear today\'s gratitude idea, say <break time="0.05s"/> give me an idea.',
    REPEAT_WELCOME_REMINDER: 'Welcome back to ' + APP_NAME + '! <break time="0.05s"/> To get a gratitude idea, say <break time="0.05s"/> give me an idea. <break time="0.05s"/> Or, to set a weekly gratitude reminder, you can say <break time="0.05s"/> set a reminder.'
};
const EMAIL_PERMISSION = 'alexa::profile:email:read';
const REMINDER_PERMISSION = 'alexa::alerts:reminders:skill:readwrite';

// Importing Arrays
const ideas = require('./arrays/ideas');
const praises = require('./arrays/praises');
const factArrays = require('./arrays/facts');
const facts = factArrays.facts;
const factTitles = factArrays.factTitles;
const longFacts = factArrays.longFacts;

// Helper Functions
const random = require('./helpers/randomHelper');
const reminder = require('./helpers/reminderHelper');

// Day Helpers
const dayHelper = require('./helpers/dayHelper');
const setDay = dayHelper.day();

//===================================
// LAUNCH HANDLER
//===================================

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {
        let speechText, cardTitle, cardContent, reprompt;
        reprompt = 'To hear today\'s gratitude idea, you can say <break time="0.05s"/> give me an idea.';
        const userId = handlerInput.requestEnvelope.session.user.userId;
        const timestamp = handlerInput.requestEnvelope.request.timestamp;
        
        try {
            const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
            var profileEmail = await upsServiceClient.getProfileEmail();
        }  catch (error) {
            profileEmail = 'not given';
            if (error.statusCode == 403) {
                console.log('USER DID NOT TOGGLE ON EMAIL PERMISSION BEFORE LAUNCH');
            } else {
                console.log('ERROR GETTING PROFILE EMAIL: ' + JSON.stringify(error));
            }
        }

        return dbHelper.checkUser(userId)
            .then((data) => {
                // If no DynamoDB Item matches userId
                if (!data) {
                    speechText = messages.FIRST_WELCOME;
                    cardTitle = `Welcome to ${APP_NAME}!`;
                    cardContent = 'To get started, say: "Give me an idea."';
                    return dbHelper.addUser(userId, profileEmail, timestamp)
                        .then ((data) => {
                            return handlerInput.responseBuilder
                              .speak(speechText)
                              .reprompt(reprompt)
                              .withSimpleCard(cardTitle, cardContent)
                              .withShouldEndSession(false)     
                              .getResponse();       
                        });
                // Else there is a DynamoDB item that matches userID
                } else {
                    cardTitle = `Welcome back to ${APP_NAME}!`;
                    cardContent = `Friendly reminder: To bring a little gratitude into your day, say, "Give me an idea."`;
                    
                    // userId found, with survey response but no email
                    if (data.profileEmail === 'not given' && (data.happy === true || data.happy === false || data.reminder === true)) {
                        if (data.reminder !== true) {
                            speechText = messages.REPEAT_WELCOME_REMINDER;
                            reprompt = 'Would you like to get a gratitude idea <break time="0.05s"/> or set a weekly gratitude reminder?';
                        } else {
                            speechText = messages.REPEAT_WELCOME;
                        }
                        return dbHelper.updateEmail(userId, profileEmail)
                            .then((data) => {
                                return handlerInput.responseBuilder
                                  .speak(speechText)
                                  .reprompt(reprompt)                                
                                  .withSimpleCard(cardTitle, cardContent)
                                  .withShouldEndSession(false)     
                                  .getResponse();
                            });
                    // userId found, but no survey response  
                    } else {
                        // Tell user about reminder feature if they don't have reminder yet
                        if (data.reminder !== true) {
                            speechText = messages.REPEAT_WELCOME_REMINDER; 
                            cardContent = 'You can also set a weekly gratitude reminder by saying, "Set a reminder."';
                        } else {
                            speechText = messages.REPEAT_WELCOME;
                        } 
                        
                        return handlerInput.responseBuilder
                          .speak(speechText)
                          .reprompt(reprompt)        
                          .withSimpleCard(cardTitle, cardContent)
                          .withShouldEndSession(false)     
                          .getResponse();
                    }
                }
            });
    }
};

//===================================
// IDEA HANDLERS
//===================================

const IdeaIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'IdeaIntent';
    },
    handle(handlerInput) {
        const idea = random.getRandomItem(ideas);
        const cta = ' <break time="0.5s"/> What do you think? You can say, <break time="0.05s"/>I\'ll do it! or <break time="0.05s"/>give me another idea';
        const speechText = 'Here\'s your idea for today: <break time="0.3s"/>' + idea + cta;
        const reprompt = 'You can say, <break time="0.05s"/>I\'ll do it! or <break time="0.05s"/>give me another idea.';
        
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        attributes.FromIdeaIntent = true;
        handlerInput.attributesManager.setSessionAttributes(attributes);
        
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(reprompt)
            .withSimpleCard('Your Idea for Today', idea.replace('<break time="0.05s"/>', ''))
            .getResponse();
    }
};

const NextIdeaIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'NextIdeaIntent';
    },
    handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        if (!attributes.FromIdeaIntent) {
            const wrongInvocationResponse = 'Were you trying to hear a new gratitude idea? You can say <break time="0.05s"/>give me an idea.';
            return handlerInput.responseBuilder
                .speak(wrongInvocationResponse)
                .withShouldEndSession(false)
                .getResponse();
        } else {
            const idea = random.getRandomItem(ideas);
            const cta = ' <break time="0.5s"/> You can say, <break time="0.05s"/>I\'ll do it! or <break time="0.05s"/>give me another idea';
            const speechText = 'How about this? <break time="0.3s"/>' + idea + cta;
            const reprompt = 'You can say, <break time="0.05s"/>I\'ll do it! or <break time="0.05s"/>give me another idea.';
            return handlerInput.responseBuilder
                .speak(speechText)
                .reprompt(reprompt)
                .withSimpleCard('Your Idea for Today', idea.replace('<break time="0.05s"/>', ''))
                .getResponse();   
        }
    }
};

//===================================
// DO IT HANDLER
//===================================

const DoItIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'DoItIntent';
    },
    async handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        if (!attributes.FromIdeaIntent) {
            return handlerInput.responseBuilder
                .speak(messages.WRONG_INVOCATION)
                .withShouldEndSession(true)
                .getResponse();
        } else {
            attributes.FromDoItIntent = true;
            handlerInput.attributesManager.setSessionAttributes(attributes);
            const praise = random.getRandomItem(praises);
            const factResults = random.getRandomFact(facts, factTitles, longFacts);
            const fact = factResults[0];
            const factTitle = factResults[1];
            const longFact = factResults[2];
            const userId = handlerInput.requestEnvelope.session.user.userId;
            var speechText = praise;
            var reprompt;
            var endSession;
            
            return dbHelper.checkUser(userId)
                .then((data) => {
                    if (data && data.happy == null) {
                        speechText = praise + messages.SURVEY;
                        cardTitle = 'Were you happy with this skill today?';
                        cardContent = 'You can say "yes" or "no.uma" Your feedback makes a huge difference!';
                        endSession = false;
                    } else {
                        speechText = praise + ' Interestingly, science suggests that ' + fact + ' <break time="0.3s"/>';
                        cardTitle = factTitle;
                        cardContent = longFact;
                        endSession = true;
                    }

                    return handlerInput.responseBuilder
                      .speak(speechText)
                      .withSimpleCard(cardTitle, cardContent)
                      .withShouldEndSession(endSession)     
                      .getResponse();
                });
        
        }
    }
};

//===================================
// YES/HAPPY HANDLER
//===================================

const YesIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && (request.intent.name === 'AMAZON.YesIntent' || request.intent.name === 'HappyIntent');
    },
    async handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        if (!attributes.FromDoItIntent) {
            return handlerInput.responseBuilder
                .speak(messages.WRONG_INVOCATION)
                .withShouldEndSession(true)
                .getResponse();
        } else {
                var speechText, cardMethod, cardContent;
                speechText = 'I\'m so glad to hear it! ';
                const userId = handlerInput.requestEnvelope.session.user.userId;
                const happy = true;
                
                return dbHelper.checkUser(userId)
                  .then((data) => {
                    if (data.profileEmail === 'not given') {
                        speechText += messages.NOTIFY_MISSING_PERMISSIONS;
                        return dbHelper.updateFeedback(userId, happy)
                          .then((data) => {
                            return handlerInput.responseBuilder
                                .speak(speechText)
                                .withAskForPermissionsConsentCard([EMAIL_PERMISSION])
                                .withShouldEndSession(true)
                                .getResponse();
                          })
                    } else if (data.profileEmail !== 'not given' || !data) {
                        speechText += ' Thanks for your feedback.'
                        return dbHelper.updateFeedback(userId, happy)
                          .then((data) => {
                            return handlerInput.responseBuilder
                                .speak(speechText)
                                .withSimpleCard('Thanks for your feedback!', 'Lisa, the developer, will send you an email soon to thank you personally.')
                                .withShouldEndSession(true)
                                .getResponse();
                          })
                        
                    }
                  })         
        }
    }
};

//===================================
// NO/UNHAPPY HANDLER
//===================================

const NoIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && (request.intent.name === 'AMAZON.NoIntent' || request.intent.name === 'NotHappyIntent');
    },
    async handle(handlerInput) {
        const attributes = handlerInput.attributesManager.getSessionAttributes();
        if (!attributes.FromDoItIntent) {
            return handlerInput.responseBuilder
                .speak(messages.WRONG_INVOCATION)
                .withShouldEndSession(true)
                .getResponse();
        } else {
                var speechText, cardMethod, cardContent;
                speechText = 'I\'m sorry to hear that. ';
                const userId = handlerInput.requestEnvelope.session.user.userId;
                const happy = false;
                
                return dbHelper.checkUser(userId)
                  .then((data) => {
                    if (data.profileEmail === 'not given') {
                        speechText += messages.NOTIFY_MISSING_PERMISSIONS;
                        return dbHelper.updateFeedback(userId, happy)
                          .then((data) => {
                            return handlerInput.responseBuilder
                                .speak(speechText)
                                .withAskForPermissionsConsentCard([EMAIL_PERMISSION])
                                .withShouldEndSession(true)
                                .getResponse();
                          })
                    } else if (data.profileEmail !== 'not given' || !data) {
                        speechText += ' Thanks for your feedback.'
                        return dbHelper.updateFeedback(userId, happy)
                          .then((data) => {
                            return handlerInput.responseBuilder
                                .speak(speechText)
                                .withSimpleCard('Thanks for your feedback.', 'Lisa, the developer, may send you an email to learn how she can make this skill better.')
                                .withShouldEndSession(true)
                                .getResponse();
                          })
                        
                    }
                  })         
        }
    }
};


//===================================
// HELP, STOP, AND ERROR HANDLERS
//===================================

const HelpIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && request.intent.name === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speechText = 'This skill can help with two things: <break time="0.05s"/> Get fresh ideas to show your partner gratitude, <break time="0.05s"/> or set a weekly gratitude reminder. <break time="0.05s"/> If you\'re done, you can also just say <break time="0.05s"/> stop. What would you like to do?';
        const reprompt = 'You can say <break time="0.05s"/> give me an idea or <break time="0.02s"/> set a reminder.'
        return handlerInput.responseBuilder
            .speak(speechText)
            .reprompt(reprompt)
            .withShouldEndSession(false)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && (request.intent.name === 'AMAZON.CancelIntent' || request.intent.name === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speechText = 'Okay. You can reopen this skill by saying <break time="0.03s"/> open ' + APP_NAME + '. <break time="0.03s"/> Good bye!';
        return handlerInput.responseBuilder
            .speak(speechText)
            .withShouldEndSession(true)
            .getResponse();
    }
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.log('Error handled: ' + error.message);

    return handlerInput.responseBuilder
      .speak(messages.ERROR)
      .reprompt('Sorry, I couldn\'t understand your command. You can ask for an idea, or say stop if you\'re done.')
      .getResponse();
  },
};

//===================================
// REMINDER INTENT HANDLER
//===================================

const ReminderIntentHandler = {
    canHandle(handlerInput) {
        const request = handlerInput.requestEnvelope.request;
        return request.type === 'IntentRequest' && (request.intent.name === 'ReminderIntent');
    },
    handle(handlerInput) {
        const userId = handlerInput.requestEnvelope.session.user.userId;
        return reminder.getReminders(handlerInput)
        .then((result) => {
            if (result === false) {
                return reminder.setReminder(handlerInput)
                    .then((result) => {
                      if (result === 'OK') {
                        const speech = `Okay. I've set a weekly gratitude reminder for ${setDay[0]}s at 7 AM. You can change the time or delete this reminder in your Alexa app.`;
                        const reminder = true;
                        return dbHelper.updateReminder(userId, reminder)
                            .then((data) => {
                                return handlerInput.responseBuilder
                                  .speak(speech)
                                  .withShouldEndSession(true)
                                  .getResponse();
                                });
                      } else if (result === 'UNAUTHORIZED') {
                        // Get their permission to show a reminder
                        return handlerInput.responseBuilder
                          .speak(`Please check your Alexa app to grant ${APP_NAME} permission to set reminders.`)
                          .withAskForPermissionsConsentCard([REMINDER_PERMISSION])
                          .withShouldEndSession(true)
                          .getResponse();
                      } else {
                        // Some other problem not auth-related
                        return handlerInput.responseBuilder
                          .speak('There was a problem setting your reminder. Please give us another try later.')
                          .withShouldEndSession(true)
                          .getResponse();
                      }
                    });                  
            } else {
                speechText = `You already have a weekly gratitude reminder set for every ${dayHelper.fullDay(result)}. Go you!`;
                return handlerInput.responseBuilder
                    .speak(speechText)
                    .withShouldEndSession(true)
                    .withSimpleCard(APP_NAME, speechText)
                    .getResponse();
            }    
        });       
    }
};

//===================================
// EXPORTING
//===================================

const skillBuilder = Alexa.SkillBuilders.custom();

exports.handler = skillBuilder
    .addRequestHandlers(
        LaunchRequestHandler,
        IdeaIntentHandler,
        NextIdeaIntentHandler,
        DoItIntentHandler,
        YesIntentHandler,
        NoIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        ReminderIntentHandler
    )
    //.addErrorHandlers(ErrorHandler)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
