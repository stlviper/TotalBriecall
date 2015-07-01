## Purpose

This wiki page shows how the backend design of the Total Briecall project evolved during development and testing.

### Pre-sprint Planning

During the pre-planning meeting, the development team decided what type of product to build based on the FDA data that was available and user interviews that collected feedback about how that data was presently accessible and consumed. The team wanted to provide less-savvy users easier access to food recall data that affects them by simplifying access to the data and organizing it in a way that is quickly understandable and creates a relevant context for the user.

After some initial data mining and analysis of the provided openFDA dataset, the development team decided to create a simple web server, in Node, to serve our web pages and provide our own API. We decided to use Node because it's fast, efficient, and using server-side javascript would allow our team to work mainly in one language. The API would fetch data from the openFDA's API using more user-friendly inputs and transform it to have more user-friendly outputs. The team realized that the dataset was inconsistent in it's structure since each text field had no prescribed format. The team also realized that some data was wrong or duplicated. All of this would require strategies to normalize the data for the user to both request and view.

Based on user feedback, the team found that localizing results to the user's state would help with data comprehension. To create geolocation-aware features that would assist users in determining geographically close recalls, all calls would need to be aware of the user's location. Basic user-preference saving would allow for additional user-friendly features, so a backend store would be needed.

The original thought was to use PostgreSQL for various reasons, but since it was harder to integrate with Node's passport module compared to Mongo, and most of the features Postgres provides are unnecessary for this scale project, we chose to use Mongo as the store.

There was some initial discussion about crawling and caching the openFDA's dataset to allow for more powerful querying. This was predominately driven by limitations of the openFDA's API, as the API did not allow for simple data operations like sorting. Users generally want to sort recalls by the most recent data and to have their data returned in a predictable order. However, given our desired featureset and the limited scope of the project, we decided that it would not be necessary to do any caching locally and agreed that it was against the spirit of the RFQ requirements to cache all the data and make calls to our local API only instead of to the FDA API. This did limit us to a narrower set of features and potentially the speed at which we could provide them, but it was determined that we had enough to implement the core of what we wanted and others could be done with simple workarounds. The only caveat was a potential API query limit imposed by openFDA. We requested a designated API key to help alleviate this issue.

We also decided to integrate social features, like sharing to Facebook and comments, to allow users to notify their social circles about important recall notices and to improve the data's content by providing supplemental, crowd-sourced data.

### Sprint 1

The overall structure of the backend remained unchanged after planning more design for the rest of the site. Basic routes and data structures were discussed and planned for implementation based on UI requirements. The team agreed that using a layered approach was best so that routes would call controllers, which would in turn call an adapter to fetch the data from the openFDA's API. This approach allowed for compartmentalization of logic, which supported easier development, integration, and testing - including unit tests and code coverage tools.

More inconsistencies and issues were discovered with the dataset throughout development. The field `recall_number` was supposed to be unique and filterable. Data mining showed that there were duplicates in the dataset. We would have to de-duplicate them if the user requested a recall by a specific id. However, a key issue was found and raised:

**Querying openFDA's api for a specific recall ID came back as no results found.**

The `recall_number` column never returns matching data. It should also be noted that the openFDA's dataset does include a `@id` column, which is actually unique unlike `recall_number`, but that column resulted in an error when attempting to pass it to the API. This meant that several planned features that would target a specific recall might not have been not be feasible. A request was sent to openFDA for a potential workaround or bug fix. In the event that no response or fix was to be had, discussions lead back to the possibility of caching the entire dataset so that we could query the data we needed. This decision was delayed until the next sprint hopting that a response would be forthcoming.

Integration with the UI required some inputs to the API to be changed to allow for more dynamic control over data being retrieved. The results were also formatted (originally just returning the recall data directly from openFDA) to remove unnecessary data and to add data that provides easier access on the client side (e.g. affected states for a recall called out specifically instead of in the distribution field). More routes were also added to allow for more generalized user information that was still deemed helpful.

The team developed a targeted filtering feature so users could sort by known allergen. For example, if a user had a peanut allergy and drank milk, they would probably want to see nut and dairy related recalls over all other recalls. This meant using more data mining techniques to create generalized categories that would match common keywords used in the reason for recall or the product description.

The team wanted to make finding a user's location very simple.  Many modern websites, especially targetting mobile users, ask the browser to provide its geolocation.  We implemented this feature, but found that a user could reject the request, or some plugins will always make the request error.  When it did work, the browser would receive a latitude and longitude, which we then converted to a state by doing a lookup to Open Street Map's [Nominatim](https://nominatim.openstreetmap.org/) service using an AJAX request.  As a fallback, we also added prompt for zip code which we could reverse lookup as a state using usps.com's public API.  The usps API required a unique API key which we built into our process environment.

### Sprint 2

Since we did not receive any updates for how to query based on a specific recall number, we decided to create a reliable method ourselves to fetch back details for a recall. The implementation for the id encoding was based around data mining to determine by filtering on other fields what would produce a small dataset from which we could match the recall number ourselves and return that specific record. We wanted to keep the encoding as small as possible as it would show up in the user's address bar and any links to that recall's details page. During testing, we found that some encoded IDs would result in 500 errors from the openFDA's API. The erroring recalls contained characters (like an apostrophe) that the API was rejecting. This required the team to create a new algorithm for the encoding method to reliably return a string that would semi-uniquely identify a recall by its properties but it would exclude anything that breaks the openFDA's API. Again, the goal was to keep the encoded data string as short as possible while maintaining high enough accuracy during filtering from the openFDA's API.

The encoded-ids returned to uniquely identify a string were causing issues with invalid characters when using them as selectors in the UI. The openFDA uses a unique id (presumably their database identifier, noted as `@id` above) that was unusable for querying but could be used in the UI as a UUID. The data, which had previously been extracted before the data was handed to the user, was re-added under a new field.

Based on user feedback, the team decided to add images to the results when populated to the prototype user interface. Doing this would involve Google Image Searching the product description and returning the top result. While a potentially powerful tool, the accuracy of the images was not something we could reliably program in to the product. Using the product description or the recalling firm's name yielded completely unrelated results. Additionally, we realized that there may be copyright or hot-linking issues with fetching results directly from Google. Since we already had some categories built in for targeting allergens, we decided to expand this to be a much broader and more generic search to cover all types of foods. This would allow us to get a small number of categories that we could serve generic images for instead of targeted, per product images. In the future, we would potentially want a specific target image, but would probably want to store and serve that image from our own dataset. Now that the categories could be matched to products, we also wanted a ranking of the category match. We created a simple algorithm to match the reason for recall or product description with the former being weighted higher as well as earlier position in the given field's data string. This allowed us to generate a weighting system to order the categories and allow for slightly higher accuracy with displaying an image for the product.

The team wanted to expand our social integration beyond Facebook sharing, resulting in the decision to add options for email and direct url linking.

With the advent of comments, we realized that our controllers directly accessing our adapters were going to lead to code duplication and additional complexity. A data abstraction layer was added to counter this.

During development we realized adding third party keys directly to the code base was not only a security issue, but it also limited ease of configuration for a new instantiation of the product. We ripped out the old keys and added them all as environment variables in Heroku to allow each instance to have configurable settings.

Our API documentation is generated by a tool called [apiDoc](http://apidocjs.com/). This is a tool that our team has used before; and, we generally build the API documentation as part of our application build steps so as to keep the generated code out of our source control repository. We attempted to follow the same path for this application, but ran into issues reconciling the platform differences between our development workstations (on Windows), our continuous integration server (on TravisCI) and our ultimate deployment location (on Heroku). Variations in the environments caused a great amount of churn as we attempted to find a solution that worked for all of the environments. Ultimately we decided to do local builds of the API documentation to avoid spending any more time on these issues.

### Sprint 3

In our final sprint we focused on simplifying deployment and ensuring a consistent experience for all users.  Feedback from users attempting to install the application showed the Facebook integration was complex due to the required key's and approval from Facebook.  We decided to hide Facebook integration if no API key is provided and only display links and emails.  We also made the application more robust by ensuring the back end could operate without a New Relic API key.  In our initial integration, the service would crash if no key was provided, but we revised how New Relic was used so that the application would not use New Relic if now key was provided.    
  
We converted the production site to use HTTPS on a custom domain name, <a href="https://www.totalbriecall.com" target="_">https://www.totalbriecall.com</a> since the Office of Management and Budget directed the use of HTTPS-everywhere.  We found an issue with our API calls to the usps.com API for zipcode lookup because it only supports HTTP.  We originally intended the user's zip code lookup to be a simple proof-of-concept and made AJAX calls directly from the user's browser to usps.  When we realized usps did not support HTTPS, and that our site would require proxying client calls through our application to make HTTP calls to the API, we replaced zip code lookup with a simple state selection tool, removing the need for a usps.com API key at all.